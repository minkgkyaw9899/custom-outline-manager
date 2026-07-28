package handlers

import (
	"context"
	"log"
	"strings"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
	"outline-manager/internal/models"
)

// createUserRequest registers a key holder and, optionally, gives them a key in
// the same call. There are three shapes:
//
//   - neither KeyID nor ServerID: the user is recorded on their own, and keys
//     are attached later.
//   - KeyID: an existing unassigned key is handed to them as-is, keeping the
//     limit and expiry it already carries.
//   - ServerID: a fresh key is provisioned on that server.
//
// KeyID wins if both are sent, since naming a specific key is the more
// specific instruction.
type createUserRequest struct {
	Name   string  `json:"name" validate:"required,max=120"`
	Note   string  `json:"note" validate:"max=500"`
	Status *string `json:"status" validate:"omitempty,oneof=active inactive"`

	KeyID    *string `json:"keyId"`
	ServerID *string `json:"serverId"`
	// KeyName defaults to the user's own name — a key belonging to a person is
	// most usefully labelled with that person, and Outline Manager's key list
	// is the other place this name shows up.
	KeyName string  `json:"keyName"`
	AddGB   float64 `json:"add_gb"`
	AddDays int     `json:"add_days"`
}

func userStatusOrDefault(v *string) models.UserStatus {
	if v == nil {
		return models.UserStatusActive
	}
	return models.UserStatus(*v)
}

// trimmedPtr is the trimmed value of an optional string field, or "" when the
// field was absent or blank — the two cases callers treat identically.
func trimmedPtr(v *string) string {
	if v == nil {
		return ""
	}
	return strings.TrimSpace(*v)
}

// claimFreeKey hands an existing unassigned key to a user and makes it what
// their dynamic link resolves to.
//
// "Free" is the point: a key adopted from an Outline server, or released by a
// previous holder, belongs to nobody and can be handed on without provisioning
// anything new. A key that already has a holder is refused rather than
// reassigned, since that would silently take away someone's access.
//
// The key keeps the limit and expiry it already carries — it is being handed
// over, not sold fresh — so there is no plan to apply here.
// newName, when non-empty, renames the key (on Outline and locally) as part
// of the claim — used only when a brand new user adopts a spare, never-used
// key, so it stops showing under whatever placeholder name it was
// pre-provisioned with. A rename failure does not fail the claim: the key is
// already successfully assigned by that point, and a rename is cosmetic.
func (a *API) claimFreeKey(ctx context.Context, userID, keyID, newName string) (*models.Key, *apiresponse.FieldError) {
	key, err := a.repo.GetKey(ctx, keyID)
	if err != nil {
		return nil, &apiresponse.FieldError{Field: "keyId", Message: "That key does not exist"}
	}
	if key.UserID != nil && *key.UserID != userID {
		return nil, &apiresponse.FieldError{
			Field: "keyId", Message: "That key already belongs to another user — unlink it from them first",
		}
	}
	if err := a.repo.SetKeyUser(ctx, key.ID, &userID); err != nil {
		return nil, &apiresponse.FieldError{Field: "keyId", Message: "That key could not be assigned"}
	}
	if err := a.repo.SetUserPrimaryKey(ctx, userID, &key.ID); err != nil {
		return nil, &apiresponse.FieldError{Field: "keyId", Message: "That key could not be assigned"}
	}
	if newName != "" && newName != key.Name {
		a.renameClaimedKey(ctx, *key, newName)
	}
	claimed, err := a.repo.GetKey(ctx, key.ID)
	if err != nil {
		return nil, &apiresponse.FieldError{Field: "keyId", Message: "That key could not be assigned"}
	}
	return claimed, nil
}

func (a *API) renameClaimedKey(ctx context.Context, key models.Key, name string) {
	server, err := a.repo.GetServer(ctx, key.ServerID)
	if err != nil {
		log.Printf("claim free key %s: rename: load server: %v", key.ID, err)
		return
	}
	client, err := a.cache.Get(server.ID, server.APIURL, server.CertSHA256)
	if err != nil {
		log.Printf("claim free key %s: rename: connect to server: %v", key.ID, err)
		return
	}
	if err := client.RenameAccessKey(ctx, key.OutlineKeyID, name); err != nil {
		log.Printf("claim free key %s: rename on outline: %v", key.ID, err)
		return
	}
	if err := a.repo.SetKeyName(ctx, key.ID, name); err != nil {
		log.Printf("claim free key %s: rename: save name: %v", key.ID, err)
	}
}

// enrichUser fills in the user's ssconf:// link, which is built against
// a.cfg.PublicBaseURL and so cannot be computed in the models layer. Every
// handler that serializes a User goes through this, mirroring enrichKey.
func (a *API) enrichUser(u models.User) models.User {
	u.DynamicAccessURL = models.DynamicAccessURL(a.cfg.PublicBaseURL, u.DynamicToken, u.Name)
	return u
}

// listUsers returns every user with their counters and the single key the
// table shows per row. The primary keys arrive as one extra query rather than
// one per user, and are matched up here by the user_id each key carries.
func (a *API) listUsers(c fiber.Ctx) error {
	users, err := a.repo.ListUsers(c.Context())
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	primaryKeys, err := a.repo.ListPrimaryKeys(c.Context())
	if err != nil {
		return apiresponse.Internal(c, "")
	}

	byUser := make(map[string]models.Key, len(primaryKeys))
	for _, k := range primaryKeys {
		if k.UserID != nil {
			byUser[*k.UserID] = a.enrichKey(k)
		}
	}
	for i := range users {
		users[i].User = a.enrichUser(users[i].User)
		if k, ok := byUser[users[i].ID]; ok {
			users[i].PrimaryKey = &k
		}
	}
	return apiresponse.Success(c, users, "")
}

// getUser returns the user with their keys, each enriched with live status so
// the detail page's counters match what the keys table shows elsewhere.
func (a *API) getUser(c fiber.Ctx) error {
	id := c.Params("id")
	user, err := a.repo.GetUser(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	keys, err := a.repo.ListKeysByUser(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	out := models.SummarizeUser(models.UserWithKeys{User: a.enrichUser(*user), Keys: a.enrichKeys(keys)})
	return apiresponse.Success(c, out, "")
}

func (a *API) createUser(c fiber.Ctx) error {
	var req createUserRequest
	if !bindJSON(c, &req) {
		return nil
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "name", Message: "Name is required"})
	}

	claimKeyID := trimmedPtr(req.KeyID)

	// Resolve the server before creating anything, so a bad server id (or a
	// claimed key whose server has vanished) fails without leaving a user
	// behind. A claimed key already knows which server it lives on; a fresh
	// one needs it named explicitly.
	var server *models.Server
	if claimKeyID != "" {
		k, err := a.repo.GetKey(c.Context(), claimKeyID)
		if err != nil {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "keyId", Message: "That key does not exist"})
		}
		s, err := a.repo.GetServer(c.Context(), k.ServerID)
		if err != nil {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "keyId", Message: "That key's server no longer exists"})
		}
		server = s
	} else if trimmedPtr(req.ServerID) != "" {
		s, err := a.repo.GetServer(c.Context(), trimmedPtr(req.ServerID))
		if err != nil {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "serverId", Message: "That server does not exist"})
		}
		server = s
	}

	// A claimed key is put on the same standard plan a fresh key would start
	// on, not whatever partial allowance it happened to be left carrying —
	// a new holder's first key reads the same regardless of where it came
	// from, and the admin can still override these figures from the form.
	var plan keyPlan
	if server != nil {
		p, ferr := resolveKeyPlan(*server, req.AddGB, req.AddDays)
		if ferr != nil {
			return apiresponse.Validation(c, *ferr)
		}
		plan = p
	}

	user, err := a.repo.CreateUser(c.Context(), req.Name, strings.TrimSpace(req.Note), userStatusOrDefault(req.Status))
	if err != nil {
		return respondRepoErr(c, err)
	}

	if claimKeyID != "" {
		// New users get the key renamed to their own name — it was sitting
		// unassigned under whatever it was pre-provisioned as.
		key, ferr := a.claimFreeKey(c.Context(), user.ID, claimKeyID, user.Name)
		if ferr != nil {
			// Same reasoning as the provisioning path below: the user was only
			// worth creating because it came with a key.
			a.discardUser(user.ID)
			return apiresponse.Validation(c, *ferr)
		}
		if err := a.applyKeyPlan(c.Context(), key.ID, plan); err != nil {
			a.discardUser(user.ID)
			return respondProvisionErr(c, *server, err)
		}
		updated, err := a.repo.GetKey(c.Context(), key.ID)
		if err != nil {
			a.discardUser(user.ID)
			return respondRepoErr(c, err)
		}
		user.PrimaryKeyID = &updated.ID
		out := models.SummarizeUser(models.UserWithKeys{User: a.enrichUser(*user), Keys: []models.Key{a.enrichKey(*updated)}})
		return apiresponse.Created(c, out, "User created and given an existing key")
	}

	if server == nil {
		return apiresponse.Created(c, models.SummarizeUser(models.UserWithKeys{User: a.enrichUser(*user)}), "User created")
	}

	keyName := strings.TrimSpace(req.KeyName)
	if keyName == "" {
		keyName = user.Name
	}
	key, err := a.provisionKey(c.Context(), *server, keyName, plan, &user.ID)
	if err != nil {
		// The user was only worth creating because it came with a key; leaving
		// a keyless record behind after a failed submit would read as success.
		a.discardUser(user.ID)
		return respondProvisionErr(c, *server, err)
	}

	// Their first key is what their dynamic link resolves to.
	if err := a.repo.AdoptPrimaryKeyIfUnset(c.Context(), user.ID, key.ID); err != nil {
		return respondRepoErr(c, err)
	}
	user.PrimaryKeyID = &key.ID

	out := models.SummarizeUser(models.UserWithKeys{User: a.enrichUser(*user), Keys: []models.Key{a.enrichKey(*key)}})
	return apiresponse.Created(c, out, "User created with an access key")
}

// discardUser best-effort removes a user we created but could not finish
// setting up. Runs on its own context so it still fires when the request
// context is what failed.
func (a *API) discardUser(id string) {
	if err := a.repo.DeleteUser(context.Background(), id); err != nil {
		log.Printf("rollback user %s: %v", id, err)
	}
}

// updateUserRequest is a partial edit: an omitted field is left alone. A note
// accepts an empty string to mean "clear this", since nil already means
// "don't touch".
type updateUserRequest struct {
	Name   *string `json:"name" validate:"omitempty,max=120"`
	Note   *string `json:"note" validate:"omitempty,max=500"`
	Status *string `json:"status" validate:"omitempty,oneof=active inactive"`
}

func (a *API) updateUser(c fiber.Ctx) error {
	id := c.Params("id")

	var req updateUserRequest
	if !bindJSON(c, &req) {
		return nil
	}
	if req.Name == nil && req.Note == nil && req.Status == nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "name", Message: "Nothing to update"})
	}

	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if trimmed == "" {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "name", Message: "Name is required"})
		}
		req.Name = &trimmed
	}

	var status *models.UserStatus
	if req.Status != nil {
		s := models.UserStatus(*req.Status)
		status = &s
	}

	if _, err := a.repo.UpdateUser(c.Context(), id, req.Name, req.Note, status); err != nil {
		return respondRepoErr(c, err)
	}
	return a.getUser(c)
}

func (a *API) deleteUser(c fiber.Ctx) error {
	if err := a.repo.DeleteUser(c.Context(), c.Params("id")); err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.NoContentOK(c, "User removed — their keys are kept, now unassigned")
}

// createUserKeyRequest gives an existing user another key, on any server. This
// is the "choose the server, create the key, link it" half of editing a user.
type createUserKeyRequest struct {
	ServerID string  `json:"serverId" validate:"required"`
	Name     string  `json:"name"`
	AddGB    float64 `json:"add_gb"`
	AddDays  int     `json:"add_days"`
}

func (a *API) createUserKey(c fiber.Ctx) error {
	id := c.Params("id")
	user, err := a.repo.GetUser(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}

	var req createUserKeyRequest
	if !bindJSON(c, &req) {
		return nil
	}
	server, err := a.repo.GetServer(c.Context(), strings.TrimSpace(req.ServerID))
	if err != nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "serverId", Message: "That server does not exist"})
	}

	plan, ferr := resolveKeyPlan(*server, req.AddGB, req.AddDays)
	if ferr != nil {
		return apiresponse.Validation(c, *ferr)
	}

	keyName := strings.TrimSpace(req.Name)
	if keyName == "" {
		keyName = user.Name
	}
	key, err := a.provisionKey(c.Context(), *server, keyName, plan, &user.ID)
	if err != nil {
		return respondProvisionErr(c, *server, err)
	}
	if err := a.repo.AdoptPrimaryKeyIfUnset(c.Context(), user.ID, key.ID); err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.Created(c, a.enrichKey(*key), "Access key created for "+user.Name)
}

// setPrimaryKeyRequest promotes one of the user's existing keys to be the one
// their ssconf:// link resolves to.
type setPrimaryKeyRequest struct {
	KeyID string `json:"keyId" validate:"required"`
}

// setUserPrimaryKey changes which key backs a holder's dynamic link, without
// touching the link itself — that is the whole point of the token living on
// the user. Every client already configured with it picks up the new
// connection on its next refresh.
func (a *API) setUserPrimaryKey(c fiber.Ctx) error {
	id := c.Params("id")
	if _, err := a.repo.GetUser(c.Context(), id); err != nil {
		return respondRepoErr(c, err)
	}

	var req setPrimaryKeyRequest
	if !bindJSON(c, &req) {
		return nil
	}
	key, err := a.repo.GetKey(c.Context(), strings.TrimSpace(req.KeyID))
	if err != nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "keyId", Message: "That key does not exist"})
	}
	// Pointing someone's link at a key they don't hold would hand them
	// somebody else's connection.
	if key.UserID == nil || *key.UserID != id {
		return apiresponse.Validation(c, apiresponse.FieldError{
			Field: "keyId", Message: "That key does not belong to this user — link it to them first",
		})
	}

	if err := a.repo.SetUserPrimaryKey(c.Context(), id, &key.ID); err != nil {
		return respondRepoErr(c, err)
	}
	return a.getUser(c)
}

// replaceUserKeyRequest moves a holder onto a different key. Either name an
// existing free key with KeyID, or give a ServerID to have a fresh one
// provisioned; KeyID wins if both are sent.
type replaceUserKeyRequest struct {
	KeyID    string  `json:"keyId"`
	ServerID string  `json:"serverId"`
	Name     string  `json:"name"`
	AddGB    float64 `json:"add_gb"`
	AddDays  int     `json:"add_days"`
}

// replaceUserKey is the "change server / change key" action on the user detail
// page: put the holder on a different key and release the one they were on.
//
// The new key is either an existing free one (keyId) or freshly provisioned on
// a chosen server (serverId). Taking over a free key is the cheaper move where
// one is available — no new key is created on the Outline server, and the key
// keeps whatever allowance it already had.
//
// The old key is unlinked, not deleted: it keeps working on its Outline server
// and keeps its usage history, so a swap is reversible and never destroys
// data. Deleting it is a separate, explicit action from the keys table.
//
// Order matters. The new key is secured first and only then becomes primary,
// so a failure part-way through leaves the holder on their original key rather
// than with no working connection at all.
func (a *API) replaceUserKey(c fiber.Ctx) error {
	id := c.Params("id")
	user, err := a.repo.GetUser(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}

	var req replaceUserKeyRequest
	if !bindJSON(c, &req) {
		return nil
	}

	previous := user.PrimaryKeyID

	// releaseOld unlinks the key the holder was on. Best-effort: they are
	// already on the new one, and a key left linked is a cosmetic problem
	// rather than a broken connection.
	releaseOld := func(newKeyID string) {
		if previous == nil || *previous == newKeyID {
			return
		}
		if err := a.repo.SetKeyUser(c.Context(), *previous, nil); err != nil {
			log.Printf("replace key for user %s: unlink old key %s: %v", id, *previous, err)
		}
	}

	if keyID := strings.TrimSpace(req.KeyID); keyID != "" {
		// No rename here — this is an existing user changing keys, not a new
		// one adopting a spare; the rename-on-claim behavior is only for the
		// new-user flow above.
		key, ferr := a.claimFreeKey(c.Context(), user.ID, keyID, "")
		if ferr != nil {
			return apiresponse.Validation(c, *ferr)
		}
		releaseOld(key.ID)
		return a.getUser(c)
	}

	server, err := a.repo.GetServer(c.Context(), strings.TrimSpace(req.ServerID))
	if err != nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "serverId", Message: "That server does not exist"})
	}

	plan, ferr := resolveKeyPlan(*server, req.AddGB, req.AddDays)
	if ferr != nil {
		return apiresponse.Validation(c, *ferr)
	}

	keyName := strings.TrimSpace(req.Name)
	if keyName == "" {
		keyName = user.Name
	}
	key, err := a.provisionKey(c.Context(), *server, keyName, plan, &user.ID)
	if err != nil {
		return respondProvisionErr(c, *server, err)
	}

	if err := a.repo.SetUserPrimaryKey(c.Context(), id, &key.ID); err != nil {
		return respondRepoErr(c, err)
	}
	releaseOld(key.ID)
	return a.getUser(c)
}

// resetUserKeyUsage gives the holder's current key a clean usage counter by
// recreating it on the same server with the same name, plan and price.
// Outline exposes no way to reset a key's transfer counter directly — it only
// resets when the key itself is recreated — so this is the honest mechanism
// rather than faking a lower number locally that the next sync would
// overwrite anyway. The dynamic link is unaffected: it resolves through the
// user, not the key. Only the static ss:// link changes.
//
// The old key is deleted before the new one is provisioned, not after: left
// in place it would still count against the server's key ceiling and could
// make the replacement fail on a server already at its limit, when a reset
// shouldn't need any spare capacity at all.
func (a *API) resetUserKeyUsage(c fiber.Ctx) error {
	id := c.Params("id")
	user, err := a.repo.GetUser(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	if user.PrimaryKeyID == nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "id", Message: "This user has no key to reset"})
	}
	old, err := a.repo.GetKey(c.Context(), *user.PrimaryKeyID)
	if err != nil {
		return respondRepoErr(c, err)
	}
	server, err := a.repo.GetServer(c.Context(), old.ServerID)
	if err != nil {
		return respondRepoErr(c, err)
	}

	if err := a.deleteRemoteKey(c.Context(), *server, old.OutlineKeyID); err != nil {
		return apiresponse.BadGateway(c, "Could not reach the Outline server to reset this key")
	}
	if err := a.repo.DeleteKey(c.Context(), old.ID); err != nil {
		return respondRepoErr(c, err)
	}

	plan := keyPlan{limitBytes: old.CustomLimitBytes, endDate: old.EndDate}
	created, err := a.provisionKey(c.Context(), *server, old.Name, plan, &user.ID)
	if err != nil {
		return apiresponse.BadGateway(c, "The old key was removed but a replacement could not be created — use \"Change key\" to give this holder a new one")
	}
	if old.PriceMmk != nil {
		if err := a.repo.SetKeyPrice(c.Context(), created.ID, old.PriceMmk); err != nil {
			log.Printf("reset usage for user %s: carry price: %v", id, err)
		}
	}
	if err := a.repo.SetUserPrimaryKey(c.Context(), id, &created.ID); err != nil {
		return respondRepoErr(c, err)
	}
	return a.getUser(c)
}

type linkUserKeyRequest struct {
	KeyID string `json:"keyId" validate:"required"`
}

// linkUserKey assigns an already-existing key to this user — the path for keys
// adopted from an Outline server, which arrive with no holder attached.
func (a *API) linkUserKey(c fiber.Ctx) error {
	id := c.Params("id")
	user, err := a.repo.GetUser(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}

	var req linkUserKeyRequest
	if !bindJSON(c, &req) {
		return nil
	}
	key, err := a.repo.GetKey(c.Context(), strings.TrimSpace(req.KeyID))
	if err != nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "keyId", Message: "That key does not exist"})
	}
	// Reassigning someone else's key silently would take their access away, so
	// it has to be unlinked first — an explicit two-step by design.
	if key.UserID != nil && *key.UserID != user.ID {
		return apiresponse.Conflict(c, "That key already belongs to another user — unlink it from them first")
	}

	if err := a.repo.SetKeyUser(c.Context(), key.ID, &user.ID); err != nil {
		return respondRepoErr(c, err)
	}
	// A holder with no key yet has a dynamic link resolving to nothing; the
	// first key they are given is what fixes that.
	if err := a.repo.AdoptPrimaryKeyIfUnset(c.Context(), user.ID, key.ID); err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.Success(c, fiber.Map{"keyId": key.ID, "userId": user.ID}, "Key linked to "+user.Name)
}

// unlinkUserKey detaches a key from its holder without deleting it: the key
// keeps working and stays on the Outline server, it just has no owner on
// record. Deleting the key outright is DELETE /keys/:id.
func (a *API) unlinkUserKey(c fiber.Ctx) error {
	id := c.Params("id")
	if _, err := a.repo.GetUser(c.Context(), id); err != nil {
		return respondRepoErr(c, err)
	}
	key, err := a.repo.GetKey(c.Context(), c.Params("keyId"))
	if err != nil {
		return respondRepoErr(c, err)
	}
	if key.UserID == nil || *key.UserID != id {
		return apiresponse.NotFound(c, "That key is not assigned to this user")
	}
	if err := a.repo.SetKeyUser(c.Context(), key.ID, nil); err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.NoContentOK(c, "Key unlinked — it keeps working, with no holder on record")
}
