package handlers

import (
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/limiter"

	"outline-manager/internal/apiresponse"
)

// globalRateLimit bounds every /api/v1 request by IP — a baseline against
// scraping/flooding, generous enough not to interfere with the dashboard's
// own polling (see frontend LIVE_REFRESH_MS).
func (a *API) globalRateLimit() fiber.Handler {
	return limiter.New(limiter.Config{
		Max:          a.cfg.RateLimitMax,
		Expiration:   a.cfg.RateLimitWindow,
		LimitReached: rateLimitReached,
	})
}

// authRateLimit is a tighter, IP-scoped limit layered on top of
// globalRateLimit for the handful of public endpoints most worth abusing:
// OTP request/verify and the share passcode status/setup/verify flow. Both
// already have their own attempt caps that lock a specific email or share
// (OTPMaxAttempts, ShareMaxAttempts) — this bounds the request rate itself,
// so an attacker can't burn through those caps (or just flood the server)
// as fast as the network allows.
func (a *API) authRateLimit() fiber.Handler {
	return limiter.New(limiter.Config{
		Max:          a.cfg.AuthRateLimitMax,
		Expiration:   a.cfg.AuthRateLimitWindow,
		LimitReached: rateLimitReached,
	})
}

func rateLimitReached(c fiber.Ctx) error {
	return apiresponse.TooManyRequests(c, "")
}
