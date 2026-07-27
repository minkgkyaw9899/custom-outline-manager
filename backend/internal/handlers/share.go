package handlers

import (
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
	"outline-manager/internal/authn"
	"outline-manager/internal/models"
	"outline-manager/internal/outline"
)

const ctxKeyShareUserID = "share_user_id"

type shareSummaryResponse struct {
	Slug        string `json:"slug"`
	PasscodeSet bool   `json:"passcodeSet"`
}

func shareSummary(s *models.UserShare) shareSummaryResponse {
	return shareSummaryResponse{Slug: s.Slug, PasscodeSet: s.PasscodeHash != nil}
}

type shareTokenPayload struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func (a *API) newShareTokenPayload(slug, userID string) (*shareTokenPayload, error) {
	token, err := authn.NewShareToken(a.cfg.JWTSecret, slug, userID, a.cfg.ShareTokenTTL)
	if err != nil {
		return nil, err
	}
	return &shareTokenPayload{Token: token, ExpiresAt: time.Now().Add(a.cfg.ShareTokenTTL)}, nil
}

// createUserShare is the admin action behind the link icon on the user detail
// page: get-or-create the one share link for this user, idempotently.
func (a *API) createUserShare(c fiber.Ctx) error {
	id := c.Params("id")
	if _, err := a.repo.GetUser(c.Context(), id); err != nil {
		return respondRepoErr(c, err)
	}
	share, err := a.repo.GetOrCreateShareForUser(c.Context(), id)
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	return apiresponse.Success(c, shareSummary(share), "")
}

// resetUserShare clears a holder's passcode (they forgot it, or the admin
// wants to revoke their current session), so the public page falls back to
// the setup screen on the next visit.
func (a *API) resetUserShare(c fiber.Ctx) error {
	id := c.Params("id")
	if err := a.repo.ResetSharePasscode(c.Context(), id); err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.NoContentOK(c, "Share passcode reset")
}

type shareCodeRequest struct {
	Code string `json:"code" validate:"required,len=6,numeric"`
}

// shareStatus tells the public page whether to show the passcode-setup
// screen (first visit ever) or the passcode-entry screen.
func (a *API) shareStatus(c fiber.Ctx) error {
	share, err := a.repo.GetShareBySlug(c.Context(), c.Params("slug"))
	if err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.Success(c, shareSummary(share), "")
}

// shareSetup is the holder's first-ever visit: they invent their own 6-digit
// passcode, which is then required on every later visit. Only reachable once
// per link — a link that already has a passcode must go through shareVerify.
func (a *API) shareSetup(c fiber.Ctx) error {
	var req shareCodeRequest
	if !bindJSON(c, &req) {
		return nil
	}

	share, err := a.repo.GetShareBySlug(c.Context(), c.Params("slug"))
	if err != nil {
		return respondRepoErr(c, err)
	}
	if share.PasscodeHash != nil {
		return apiresponse.Conflict(c, "A passcode has already been set for this link — enter it instead")
	}

	if err := a.repo.SetSharePasscode(c.Context(), share.ID, authn.HashOTP(req.Code)); err != nil {
		return apiresponse.Internal(c, "")
	}

	payload, err := a.newShareTokenPayload(share.Slug, share.UserID)
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	return apiresponse.Success(c, payload, "Passcode set")
}

// shareVerify is every visit after the first: the holder re-enters the same
// passcode they set up originally. Locks out after cfg.ShareMaxAttempts wrong
// codes for cfg.ShareLockDuration, so the 6-digit space can't be brute-forced
// against the holder's real access URL.
func (a *API) shareVerify(c fiber.Ctx) error {
	var req shareCodeRequest
	if !bindJSON(c, &req) {
		return nil
	}

	share, err := a.repo.GetShareBySlug(c.Context(), c.Params("slug"))
	if err != nil {
		return respondRepoErr(c, err)
	}
	if share.PasscodeHash == nil {
		return apiresponse.Conflict(c, "This link has not been set up yet")
	}
	if share.LockedUntil != nil && time.Now().Before(*share.LockedUntil) {
		return apiresponse.Forbidden(c, "Too many incorrect attempts — try again in a few minutes")
	}

	if !authn.VerifyOTP(req.Code, *share.PasscodeHash) {
		if err := a.repo.RecordShareFailure(c.Context(), share.ID, a.cfg.ShareMaxAttempts, time.Now().Add(a.cfg.ShareLockDuration)); err != nil {
			log.Printf("record share failure %s: %v", share.ID, err)
		}
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "code", Message: "Incorrect passcode"})
	}
	if err := a.repo.ResetShareFailures(c.Context(), share.ID); err != nil {
		return apiresponse.Internal(c, "")
	}

	payload, err := a.newShareTokenPayload(share.Slug, share.UserID)
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	return apiresponse.Success(c, payload, "Signed in")
}

// RequireShareAuth gates GET /share/:slug/view on a valid share-session
// Bearer token. Bearer-only (no cookie): this is a separate, unauthenticated
// visitor session, not the admin's.
func (a *API) RequireShareAuth() fiber.Handler {
	return func(c fiber.Ctx) error {
		authz := c.Get("Authorization")
		if !strings.HasPrefix(authz, "Bearer ") {
			return apiresponse.Unauthorized(c, "Enter your passcode to view this key")
		}
		claims, err := authn.ParseShareToken(a.cfg.JWTSecret, strings.TrimPrefix(authz, "Bearer "))
		if err != nil || claims.Slug != c.Params("slug") {
			return apiresponse.Unauthorized(c, "This link has expired — enter your passcode again")
		}
		c.Locals(ctxKeyShareUserID, claims.UserID)
		return c.Next()
	}
}

// shareView is the read-only status payload the holder sees, built from their
// primary key. It deliberately omits everything not in the holder-facing spec:
// port, cipher, the outline key id, the server link, and both the limit and
// renewal history tables — those stay admin-only.
//
// The holder's own name comes from the user record rather than the key, so
// swapping which key backs them doesn't change what their page is titled.
func (a *API) shareView(c fiber.Ctx) error {
	slug := c.Params("slug")

	share, err := a.repo.GetShareBySlug(c.Context(), slug)
	if err != nil {
		return respondRepoErr(c, err)
	}
	user, err := a.repo.GetUser(c.Context(), share.UserID)
	if err != nil {
		return respondRepoErr(c, err)
	}

	// No key attached yet (a user created without one, or whose key was
	// removed): the page still loads and says so, rather than 404ing a link
	// the holder was legitimately given. Same field set as the normal path so
	// the client has one shape to render, with hasKey deciding what it shows.
	if user.PrimaryKeyID == nil {
		return apiresponse.Success(c, fiber.Map{
			"name":             user.Name,
			"hasKey":           false,
			"usedBytes":        0,
			"customLimitBytes": nil,
			"remainingBytes":   nil,
			"endDate":          nil,
			"daysLeft":         nil,
			"status":           models.StatusDisabled,
			"accessUrl":        "",
			"dynamicAccessUrl": "",
			"host":             "",
			"createdAt":        user.CreatedAt,
			"updatedAt":        user.UpdatedAt,
			"metrics":          nil,
			"dailySeries":      []models.DailyUsage{},
			"dailyGranularity": "day",
		}, "")
	}

	key, err := a.repo.GetKey(c.Context(), *user.PrimaryKeyID)
	if err != nil {
		return respondRepoErr(c, err)
	}
	server, err := a.repo.GetServer(c.Context(), key.ServerID)
	if err != nil {
		return respondRepoErr(c, err)
	}

	_, keyMetrics := a.liveMetrics(c.Context(), *server, outline.Window30d)
	var metrics *models.KeyMetrics
	if m, ok := keyMetrics[key.OutlineKeyID]; ok {
		metrics = &m
	}

	granularity, dailySeries, err := a.keyUsageSeries(c.Context(), *key)
	if err != nil {
		log.Printf("share view %s: daily usage: %v", slug, err)
		dailySeries = []models.DailyUsage{}
		granularity = "day"
	}

	enriched := a.enrichKey(*key)
	return apiresponse.Success(c, fiber.Map{
		"name":             user.Name,
		"hasKey":           true,
		"usedBytes":        enriched.UsedBytes,
		"customLimitBytes": enriched.CustomLimitBytes,
		"remainingBytes":   enriched.RemainingBytes,
		"endDate":          enriched.EndDate,
		"daysLeft":         enriched.DaysLeft,
		"status":           enriched.Status,
		"accessUrl":        keyAccessURLWithName(enriched),
		// The user's link, not the key's: it survives the admin moving this
		// holder to a different server, so it is the one worth copying.
		"dynamicAccessUrl": models.DynamicAccessURL(a.cfg.PublicBaseURL, user.DynamicToken, user.Name),
		"host":             server.Hostname(),
		"createdAt":        enriched.CreatedAt,
		"updatedAt":        enriched.UpdatedAt,
		"metrics":          metrics,
		"dailySeries":      dailySeries,
		"dailyGranularity": granularity,
	}, "")
}
