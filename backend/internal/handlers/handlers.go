// Package handlers wires the REST API (Fiber) to the repository, the Outline
// client cache, and the enforcement reconciler. It contains no business logic:
// quota/date math lives in internal/models, and anything that talks to an
// Outline server goes through internal/enforcement or internal/outline.
//
// Every response — success or error — goes through internal/apiresponse so
// the frontend can rely on one envelope shape across the entire API.
package handlers

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
	"outline-manager/internal/config"
	"outline-manager/internal/enforcement"
	"outline-manager/internal/outline"
	"outline-manager/internal/repository"
	"outline-manager/internal/telegram"
)

type API struct {
	repo     *repository.Repository
	cache    *outline.Cache
	enforcer *enforcement.Enforcer
	cfg      *config.Config
	timeout  time.Duration
	// tg is nil whenever Telegram alerting isn't configured; telegramWebhook
	// checks cfg.TelegramBotToken before ever touching it.
	tg *telegram.Client
}

func New(repo *repository.Repository, cache *outline.Cache, enforcer *enforcement.Enforcer, cfg *config.Config, tg *telegram.Client) *API {
	return &API{repo: repo, cache: cache, enforcer: enforcer, cfg: cfg, timeout: cfg.RequestTimeout, tg: tg}
}

// RegisterRoutes mounts the JSON API under /api/v1. Auth endpoints are public;
// everything else requires a valid admin session.
func (a *API) RegisterRoutes(r fiber.Router) {
	v1 := r.Group("/api/v1")
	v1.Use(a.globalRateLimit())
	{
		v1.Get("/health", a.health)

		// Public dynamic access key resolution (see internal/handlers/dynamic_key.go):
		// fetched directly by Outline client apps, never by this dashboard's UI.
		v1.Get("/dkey/:token", a.dynamicKey)

		// Public Telegram webhook: authenticated by the secret-token header
		// and the trusted admin user id, not the session cookie (Telegram's
		// servers have neither). See telegramWebhook.
		v1.Post("/telegram/webhook", a.telegramWebhook)

		// Public payment instructions for the self-serve order page —
		// deliberately its own narrow endpoint rather than a public flag on
		// GET /settings, so mmk_per_usd (an internal cost figure) can never
		// leak through it. See settings.go.
		v1.Get("/settings/public", a.getPublicPaymentInfo)

		// Public self-serve order flow. getPublicServers is a narrow,
		// name-only server list (never api_url/cert/cost, unlike the
		// protected /servers). createOrder is rate-limited like the other
		// public write endpoints — the only anti-abuse layer here, since
		// payment confirmation is manual and happens later, out of band.
		v1.Get("/servers/public", a.getPublicServers)
		v1.Post("/orders", a.authRateLimit(), a.createOrder)

		auth := v1.Group("/auth")
		{
			auth.Post("/request-otp", a.authRateLimit(), a.requestOTP)
			auth.Post("/verify-otp", a.authRateLimit(), a.verifyOTP)
			auth.Post("/logout", a.logout)
			auth.Get("/me", a.RequireAuth(), a.me)
		}

		// Public share-view session: the key holder's passcode-gated status
		// page. Not behind RequireAuth — this is a separate, unauthenticated
		// visitor session scoped to one slug (see RequireShareAuth).
		share := v1.Group("/share/:slug")
		{
			share.Get("/status", a.authRateLimit(), a.shareStatus)
			share.Post("/setup", a.authRateLimit(), a.shareSetup)
			share.Post("/verify", a.authRateLimit(), a.shareVerify)
			share.Get("/view", a.RequireShareAuth(), a.shareView)
		}

		protected := v1.Group("")
		protected.Use(a.RequireAuth())
		{
			protected.Get("/stats", a.getStats)

			protected.Get("/settings", a.getSettings)
			protected.Patch("/settings", a.updateSettings)

			protected.Get("/analytics/retention", a.getRetentionAnalytics)

			protected.Get("/orders", a.listOrders)
			protected.Get("/orders/:id", a.getOrder)
			protected.Post("/orders/:id/approve", a.approveOrder)
			protected.Post("/orders/:id/reject", a.rejectOrder)
			protected.Delete("/orders/:id", a.deleteOrder)

			protected.Get("/admins", a.listAdmins)
			protected.Post("/admins", a.addAdmin)
			protected.Delete("/admins/:email", a.deleteAdmin)
			protected.Patch("/admins/:email/status", a.setAdminStatus)

			protected.Get("/users", a.listUsers)
			protected.Post("/users", a.createUser)
			protected.Get("/users/:id", a.getUser)
			protected.Patch("/users/:id", a.updateUser)
			protected.Delete("/users/:id", a.deleteUser)
			protected.Post("/users/:id/keys", a.createUserKey)
			protected.Post("/users/:id/keys/link", a.linkUserKey)
			protected.Post("/users/:id/keys/replace", a.replaceUserKey)
			protected.Post("/users/:id/reset-usage", a.resetUserKeyUsage)
			protected.Patch("/users/:id/primary-key", a.setUserPrimaryKey)
			protected.Delete("/users/:id/keys/:keyId", a.unlinkUserKey)
			protected.Post("/users/:id/share", a.createUserShare)
			protected.Post("/users/:id/share/reset", a.resetUserShare)

			protected.Post("/servers", a.createServer)
			protected.Get("/servers", a.listServers)
			protected.Post("/servers/sync-all", a.syncAllServers)
			protected.Get("/servers/:id", a.getServer)
			protected.Patch("/servers/:id/config", a.updateServerConfig)
			protected.Patch("/servers/:id/default-limit", a.setServerDefaultLimit)
			protected.Delete("/servers/:id", a.deleteServer)
			protected.Post("/servers/:id/sync", a.syncServer)
			protected.Post("/servers/:id/bandwidth/enable", a.reenableServerBandwidth)
			protected.Get("/servers/:id/usage", a.getServerUsage)
			protected.Get("/servers/:id/renewals", a.listServerRenewals)
			protected.Post("/servers/:id/keys", a.createKey)

			protected.Get("/keys", a.listKeys)
			protected.Get("/keys/:id", a.getKey)
			protected.Patch("/keys/:id", a.updateKey)
			protected.Delete("/keys/:id", a.deleteKey)
			protected.Post("/keys/:id/renew", a.renewKey)
			protected.Get("/keys/:id/renewals", a.listRenewals)
			protected.Patch("/keys/:id/renewals/:renewalId/payment", a.updateRenewalPayment)
			protected.Get("/keys/:id/daily", a.getKeyDaily)
		}
	}
}

// health reports process liveness plus whether Postgres is reachable, so
// container orchestration and the frontend can distinguish "app down" from
// "database down". Intentionally public.
func (a *API) health(c fiber.Ctx) error {
	if err := a.repo.Ping(c.Context()); err != nil {
		return apiresponse.Error(c, 503, apiresponse.CodeInternalServerErr, "Database is unreachable")
	}
	return apiresponse.Success(c, fiber.Map{"status": "ok", "database": "ok"}, "Service is healthy")
}

func (a *API) getStats(c fiber.Ctx) error {
	stats, err := a.repo.DashboardStats(c.Context())
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	return apiresponse.Success(c, stats, "Dashboard stats retrieved")
}

// respondRepoErr maps a repository error to the standardized envelope: a
// missing row is 404, anything else is a 500.
func respondRepoErr(c fiber.Ctx, err error) error {
	if errors.Is(err, repository.ErrNotFound) {
		return apiresponse.NotFound(c, "The requested resource does not exist")
	}
	return apiresponse.Internal(c, "")
}
