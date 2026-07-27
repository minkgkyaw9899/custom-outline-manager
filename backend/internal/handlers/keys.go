package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
	"outline-manager/internal/models"
)

type createKeyRequest struct {
	Name    string  `json:"name"`
	AddGB   float64 `json:"add_gb"`
	AddDays int     `json:"add_days"`
	// UserID hands the key to a key holder as it is created. Nil leaves it
	// unassigned, which is what a key adopted from Outline looks like.
	UserID *string `json:"user_id"`
}

// applyPlanMinimums normalizes a create/renew allowance to the plan floor:
// zero (or absent) means "one plan period", and anything positive but below a
// floor is rejected rather than silently rounded up, so a typo surfaces
// instead of quietly selling a bigger plan than the caller asked for.
func applyPlanMinimums(addGB *float64, addDays *int) *apiresponse.FieldError {
	switch {
	case *addGB < 0 || *addDays < 0:
		return &apiresponse.FieldError{Field: "add_gb", Message: "add_gb and add_days must not be negative"}
	case *addGB > 0 && *addGB < models.MinPlanGB:
		return &apiresponse.FieldError{Field: "add_gb", Message: "A key must be given at least 200 GB"}
	case *addDays > 0 && *addDays < models.MinPlanDays:
		return &apiresponse.FieldError{Field: "add_days", Message: "A key must be given at least 30 days"}
	}
	if *addGB == 0 {
		*addGB = models.MinPlanGB
	}
	if *addDays == 0 {
		*addDays = models.MinPlanDays
	}
	return nil
}

// keyDisplayName is the label to show for a key that was never given its own
// name — mirrors the frontend's keyDisplayName in key-connection-status.tsx.
func keyDisplayName(k models.Key) string {
	if name := strings.TrimSpace(k.Name); name != "" {
		return name
	}
	return "Key " + k.OutlineKeyID
}

// keyAccessURLWithName is the static ss:// access URL with the key's display
// name set as its fragment, mirroring the frontend's keyAccessUrlWithName —
// Outline's accessUrl on its own has no name in it, so anywhere it's handed
// out on the key's behalf (the share view) should carry the name instead of
// the bare link.
func keyAccessURLWithName(k models.Key) string {
	base, _, _ := strings.Cut(k.AccessURL, "#")
	return base + "#" + url.PathEscape(keyDisplayName(k))
}

// enrichKey applies the live-computed status/daysLeft/remainingBytes fields
// plus the dynamic access URL, built against a.cfg.PublicBaseURL.
// models.Key.Enrich has no access to that config, so every handler that
// serializes a Key goes through this instead of calling Enrich directly —
// that keeps "static ss:// vs dynamic ssconf://" a decision made in exactly
// one place.
func (a *API) enrichKey(k models.Key) models.Key {
	k = k.Enrich(time.Now())
	k.DynamicAccessURL = models.DynamicAccessURL(a.cfg.PublicBaseURL, k.DynamicToken, keyDisplayName(k))
	return k
}

func (a *API) enrichKeys(keys []models.Key) []models.Key {
	out := make([]models.Key, 0, len(keys))
	for _, k := range keys {
		out = append(out, a.enrichKey(k))
	}
	return out
}

// Failure modes of provisionKey, mapped to responses by respondProvisionErr.
// Sentinels rather than direct responses because provisionKey is shared by two
// endpoints that report a failure differently — creating a user rolls the
// whole user back, creating a key on a server does not.
var (
	errKeyCeilingReached  = errors.New("server key ceiling reached")
	errOutlineUnreachable = errors.New("could not reach the Outline server")
	errKeyNotRecorded     = errors.New("key could not be recorded")
	errKeyLimitNotPushed  = errors.New("initial data limit could not be applied")
)

// keyPlan is the allowance a new key starts on, already resolved against the
// server's default quota and the plan floor.
type keyPlan struct {
	limitBytes *int64
	endDate    *time.Time
}

// resolveKeyPlan turns a requested allowance into concrete figures. An absent
// (zero) data allowance means "whatever this server hands out by default",
// falling back to the plan floor when the server has no default of its own —
// note a server default deliberately isn't held to MinPlanGB, since an admin
// who set the server to 50 GB meant it (same reasoning as updateKey's manual
// override).
func resolveKeyPlan(server models.Server, addGB float64, addDays int) (keyPlan, *apiresponse.FieldError) {
	requestedGB := addGB
	if ferr := applyPlanMinimums(&addGB, &addDays); ferr != nil {
		return keyPlan{}, ferr
	}
	if requestedGB == 0 && server.DefaultLimitBytes != nil {
		addGB = float64(*server.DefaultLimitBytes) / models.BytesPerGB
	}

	var plan keyPlan
	if addGB > 0 {
		v := int64(addGB * models.BytesPerGB)
		plan.limitBytes = &v
	}
	if addDays > 0 {
		t := time.Now().AddDate(0, 0, addDays)
		plan.endDate = &t
	}
	return plan, nil
}

// provisionKey creates one key on an Outline server, records it locally
// against userID (nil for an unassigned key), and pushes its initial limit.
// Shared by POST /servers/:id/keys and the user-creation flow so both honour
// the server's key ceiling and default quota identically.
func (a *API) provisionKey(ctx context.Context, server models.Server, name string, plan keyPlan, userID *string) (*models.Key, error) {
	// Check the ceiling before touching Outline: a key created and then
	// rolled back would burn an Outline key id for nothing.
	if server.MaxKeys != nil {
		count, err := a.repo.CountKeysByServer(ctx, server.ID)
		if err != nil {
			return nil, err
		}
		if count >= *server.MaxKeys {
			return nil, errKeyCeilingReached
		}
	}

	client, err := a.cache.Get(server.ID, server.APIURL, server.CertSHA256)
	if err != nil {
		return nil, errOutlineUnreachable
	}

	remoteKey, err := client.CreateAccessKey(ctx, strings.TrimSpace(name))
	if err != nil {
		// A rename failure still leaves a usable key behind on the server; drop
		// it rather than leaking an untracked key.
		if remoteKey != nil {
			a.discardRemoteKey(server.ID, remoteKey.ID)
		}
		return nil, errOutlineUnreachable
	}

	key, err := a.repo.CreateKey(ctx, server.ID, remoteKey.ID, remoteKey.Name, remoteKey.AccessURL, remoteKey.Port, remoteKey.Method, remoteKey.Password, plan.limitBytes, plan.endDate, userID)
	if err != nil {
		// The key exists on Outline but we failed to record it, so it would be
		// unmanaged and unenforceable. Remove it and report the failure.
		a.discardRemoteKey(server.ID, remoteKey.ID)
		return nil, errKeyNotRecorded
	}

	// Push the initial limit through the same reconciler the cron uses, so
	// there is exactly one code path that decides what Outline should enforce.
	if err := a.enforcer.ReconcileKeyByID(ctx, key.ID); err != nil {
		return key, errKeyLimitNotPushed
	}

	created, err := a.repo.GetKey(ctx, key.ID)
	if err != nil {
		return key, err
	}
	return created, nil
}

// respondProvisionErr maps a provisionKey failure to the standard envelope.
// serverName is used to make the ceiling message name the server the admin was
// actually working on.
func respondProvisionErr(c fiber.Ctx, server models.Server, err error) error {
	switch {
	case errors.Is(err, errKeyCeilingReached):
		limit := 0
		if server.MaxKeys != nil {
			limit = *server.MaxKeys
		}
		return apiresponse.Conflict(c, fmt.Sprintf(
			"%s is at its limit of %d key%s. Raise the key limit in server settings, or delete a key first.",
			server.Name, limit, plural(limit)))
	case errors.Is(err, errOutlineUnreachable):
		return apiresponse.BadGateway(c, "Could not create the key on the Outline server")
	case errors.Is(err, errKeyLimitNotPushed):
		return apiresponse.BadGateway(c, "Key was created but the initial data limit could not be applied")
	case errors.Is(err, errKeyNotRecorded):
		return apiresponse.Internal(c, "")
	default:
		return respondRepoErr(c, err)
	}
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func (a *API) createKey(c fiber.Ctx) error {
	serverID := c.Params("id")
	server, err := a.repo.GetServer(c.Context(), serverID)
	if err != nil {
		return respondRepoErr(c, err)
	}

	// An empty body is allowed: it means "one standard plan period", which is
	// the smallest key we sell.
	var req createKeyRequest
	if c.HasBody() {
		if !bindJSON(c, &req) {
			return nil
		}
	}
	plan, ferr := resolveKeyPlan(*server, req.AddGB, req.AddDays)
	if ferr != nil {
		return apiresponse.Validation(c, *ferr)
	}

	// A key may be handed straight to a user at creation time, which is what
	// the users page does; the server's own "new key" dialog leaves it unset.
	if req.UserID != nil {
		if _, err := a.repo.GetUser(c.Context(), *req.UserID); err != nil {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "user_id", Message: "That user does not exist"})
		}
	}

	created, err := a.provisionKey(c.Context(), *server, req.Name, plan, req.UserID)
	if err != nil {
		return respondProvisionErr(c, *server, err)
	}
	return apiresponse.Created(c, a.enrichKey(*created), "Access key created")
}

// discardRemoteKey best-effort deletes a key we created on Outline but could
// not finish adopting locally. Runs on its own short-lived context so it still
// fires when the request context is the thing that just failed.
func (a *API) discardRemoteKey(serverID, outlineKeyID string) {
	server, err := a.repo.GetServer(context.Background(), serverID)
	if err != nil {
		log.Printf("rollback key %s: load server: %v", outlineKeyID, err)
		return
	}
	client, err := a.cache.Get(server.ID, server.APIURL, server.CertSHA256)
	if err != nil {
		log.Printf("rollback key %s: build client: %v", outlineKeyID, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), a.timeout)
	defer cancel()
	if err := client.DeleteAccessKey(ctx, outlineKeyID); err != nil {
		log.Printf("rollback key %s on server %s: %v", outlineKeyID, server.Name, err)
	}
}

// listKeys returns every key, or only the ones with no holder attached when
// called with ?unassigned=true — that filtered list is what the users page's
// "link an existing key" picker offers.
func (a *API) listKeys(c fiber.Ctx) error {
	var (
		keys []models.Key
		err  error
	)
	if c.Query("unassigned") == "true" {
		keys, err = a.repo.ListUnassignedKeys(c.Context())
	} else {
		keys, err = a.repo.ListAllKeys(c.Context())
	}
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	return apiresponse.Success(c, a.enrichKeys(keys), "")
}

func (a *API) getKey(c fiber.Ctx) error {
	key, err := a.repo.GetKey(c.Context(), c.Params("id"))
	if err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.Success(c, a.enrichKey(*key), "")
}

// deleteKey removes the key from Outline first, then locally. If the Outline
// server can't be reached the key would keep working while disappearing from
// the dashboard, so the delete fails instead — unless the caller passes
// ?force=true to drop the local record anyway.
func (a *API) deleteKey(c fiber.Ctx) error {
	id := c.Params("id")
	force := c.Query("force") == "true"

	key, err := a.repo.GetKey(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	server, err := a.repo.GetServer(c.Context(), key.ServerID)
	if err != nil {
		return respondRepoErr(c, err)
	}

	if err := a.deleteRemoteKey(c.Context(), *server, key.OutlineKeyID); err != nil && !force {
		return apiresponse.BadGateway(c, "Could not delete the key on the Outline server (retry with ?force=true to remove it from the dashboard only)")
	}

	if err := a.repo.DeleteKey(c.Context(), id); err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.NoContentOK(c, "Access key deleted")
}

func (a *API) deleteRemoteKey(ctx context.Context, server models.Server, outlineKeyID string) error {
	client, err := a.cache.Get(server.ID, server.APIURL, server.CertSHA256)
	if err != nil {
		return err
	}
	return client.DeleteAccessKey(ctx, outlineKeyID)
}

// updateKeyRequest carries absolute values, unlike renew's relative ones.
// Every field is optional: a nil field is left as it is, so a caller can
// rename without touching the plan, or correct a limit without touching the
// name. Renewal minimums deliberately do not apply here — this is the manual
// override used to put keys adopted from an existing server onto sensible
// figures, and to fix a limit that a renewal computed as usage plus an
// allowance ("206.9 GB") down to a round number ("200 GB").
type updateKeyRequest struct {
	Name    *string  `json:"name" validate:"omitempty,max=100"`
	LimitGB *float64 `json:"limit_gb"`
	// A date ("2026-08-24", read as the end of that day) or a full RFC3339
	// timestamp.
	EndDate *string `json:"end_date"`
}

// updateKey applies absolute edits to one key: its name, its total data limit,
// its expiry, or any combination.
//
// The rename goes to Outline first, because the sync loop copies Outline's
// name back over ours and a local-only rename would be reverted on the next
// tick. A changed limit or expiry is pushed through the same reconciler the
// cron uses, so an edit that puts the key over its (new) ceiling switches it
// off immediately rather than at the next tick.
func (a *API) updateKey(c fiber.Ctx) error {
	id := c.Params("id")

	var req updateKeyRequest
	if !bindJSON(c, &req) {
		return nil
	}

	key, err := a.repo.GetKey(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}

	var name string
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if name == "" {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "name", Message: "name is required"})
		}
	}

	limitBytes := key.CustomLimitBytes
	if req.LimitGB != nil {
		if *req.LimitGB <= 0 {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "limit_gb", Message: "limit_gb must be greater than zero"})
		}
		v := int64(*req.LimitGB * models.BytesPerGB)
		limitBytes = &v
	}

	endDate := key.EndDate
	if req.EndDate != nil {
		parsed, perr := parseEndDate(*req.EndDate)
		if perr != nil {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "end_date", Message: "end_date must be a date (2026-08-24) or an RFC3339 timestamp"})
		}
		endDate = parsed
	}

	if req.Name == nil && req.LimitGB == nil && req.EndDate == nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "name", Message: "Nothing to update"})
	}

	if req.Name != nil {
		server, serr := a.repo.GetServer(c.Context(), key.ServerID)
		if serr != nil {
			return respondRepoErr(c, serr)
		}
		client, cerr := a.cache.Get(server.ID, server.APIURL, server.CertSHA256)
		if cerr != nil {
			return apiresponse.BadGateway(c, "Could not connect to the Outline server")
		}
		if rerr := client.RenameAccessKey(c.Context(), key.OutlineKeyID, name); rerr != nil {
			return apiresponse.BadGateway(c, "Could not rename the key on the Outline server")
		}
		if serr := a.repo.SetKeyName(c.Context(), id, name); serr != nil {
			return apiresponse.Internal(c, "")
		}
	}

	planChanged := req.LimitGB != nil || req.EndDate != nil
	if planChanged {
		if err := a.repo.SetKeyLimitAndEndDate(c.Context(), id, limitBytes, endDate); err != nil {
			return apiresponse.Internal(c, "")
		}
		// Logged with a zero allowance: nothing was *added*, the figures were
		// set outright, and the history table reads that as an adjustment.
		if _, err := a.repo.InsertRenewalLog(c.Context(), id, 0, 0, limitBytes, endDate); err != nil {
			return apiresponse.Internal(c, "")
		}
		if err := a.enforcer.ReconcileKeyByID(c.Context(), id); err != nil {
			return apiresponse.BadGateway(c, "The change was saved but could not be pushed to the Outline server yet")
		}
	}

	updated, err := a.repo.GetKey(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	enriched := a.enrichKey(*updated)
	return apiresponse.Success(c, enriched, "Access key updated")
}

// parseEndDate accepts a plain date or a full timestamp. A plain date is taken
// as the *end* of that day, so "expires 24 Aug" means the key still works
// through the 24th rather than dying at midnight as it begins.
func parseEndDate(raw string) (*time.Time, error) {
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return &t, nil
	}
	day, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return nil, err
	}
	end := day.Add(24*time.Hour - time.Second)
	return &end, nil
}

type renewKeyRequest struct {
	AddGB   float64 `json:"add_gb"`
	AddDays int     `json:"add_days"`
}

// renewKey implements the "smart quota renewal & extension" logic: add_gb tops
// up the limit relative to bytes already used (so the holder always gets a
// fresh add_gb of headroom, regardless of history), and add_days extends
// end_date from max(now, current end_date). See models.RenewalTarget.
func (a *API) renewKey(c fiber.Ctx) error {
	id := c.Params("id")

	var req renewKeyRequest
	if !bindJSON(c, &req) {
		return nil
	}
	// A renewal always grants a whole plan period: data and days move together,
	// so an extended key is never left with time but no quota (or the reverse).
	if err := applyPlanMinimums(&req.AddGB, &req.AddDays); err != nil {
		return apiresponse.Validation(c, *err)
	}

	key, err := a.repo.GetKey(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}

	newLimitBytes, newEndDate := models.RenewalTarget(time.Now(), *key, req.AddGB, req.AddDays)

	if err := a.repo.SetKeyLimitAndEndDate(c.Context(), id, newLimitBytes, newEndDate); err != nil {
		return apiresponse.Internal(c, "")
	}

	renewal, err := a.repo.InsertRenewalLog(c.Context(), id, req.AddGB, req.AddDays, newLimitBytes, newEndDate)
	if err != nil {
		return apiresponse.Internal(c, "")
	}

	// Push the change to Outline immediately rather than waiting for the next
	// cron tick, so a renewed key is usable right away.
	if err := a.enforcer.ReconcileKeyByID(c.Context(), id); err != nil {
		return apiresponse.BadGateway(c, "Renewal was saved but could not be pushed to the Outline server yet")
	}

	updated, err := a.repo.GetKey(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	enriched := a.enrichKey(*updated)

	return apiresponse.Success(c, fiber.Map{"key": enriched, "renewal": renewal}, "Access key renewed")
}

// keyDailyDays is how much snapshot history the key detail chart covers. Kept
// in step with sparklineDays so a key's chart and its server's cover the same
// span.
const keyDailyDays = sparklineDays

// keyHourlyThreshold is how young a key has to be to get an hour-bucketed
// chart instead of a day-bucketed one — a key created within the current day
// would otherwise show at most a single day bucket, too little to draw a
// trend from.
const keyHourlyThreshold = 24 * time.Hour

// keyHourlyHours is how much snapshot history the hourly chart covers.
const keyHourlyHours = 24

// keyUsageSeries picks hour buckets for a key younger than keyHourlyThreshold
// and day buckets otherwise, so a key's traffic chart has something to show
// from its very first day instead of waiting on calendar days to accumulate.
func (a *API) keyUsageSeries(ctx context.Context, key models.Key) (granularity string, series []models.DailyUsage, err error) {
	if time.Since(key.CreatedAt) < keyHourlyThreshold {
		series, err = a.repo.HourlyUsageByKey(ctx, key.ID, keyHourlyHours)
		return "hour", series, err
	}
	series, err = a.repo.DailyUsageByKey(ctx, key.ID, keyDailyDays)
	return "day", series, err
}

func (a *API) getKeyDaily(c fiber.Ctx) error {
	id := c.Params("id")
	key, err := a.repo.GetKey(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	granularity, series, err := a.keyUsageSeries(c.Context(), *key)
	if err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.Success(c, fiber.Map{"granularity": granularity, "series": series}, "")
}

func (a *API) listRenewals(c fiber.Ctx) error {
	id := c.Params("id")
	if _, err := a.repo.GetKey(c.Context(), id); err != nil {
		return respondRepoErr(c, err)
	}
	logs, err := a.repo.ListRenewalLogs(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.Success(c, logs, "")
}
