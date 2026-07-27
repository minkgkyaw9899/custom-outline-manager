package handlers

import (
	"context"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
	"outline-manager/internal/authn"
)

const (
	ctxKeyEmail  = "auth_email"
	ctxKeyIsRoot = "auth_is_root"
)

// RequireAuth reads the session JWT from the auth cookie (or, as a fallback
// for non-browser clients, an Authorization: Bearer header), validates it,
// and stores the admin's email/root status in request-scoped Locals. Every
// protected route sits behind this.
func (a *API) RequireAuth() fiber.Handler {
	return func(c fiber.Ctx) error {
		token, ok := extractToken(c)
		if !ok {
			return apiresponse.Unauthorized(c, "Sign in required")
		}

		claims, err := authn.ParseToken(a.cfg.JWTSecret, token)
		if err != nil {
			return apiresponse.Unauthorized(c, "Your session has expired — please sign in again")
		}

		c.Locals(ctxKeyEmail, claims.Email)
		c.Locals(ctxKeyIsRoot, claims.IsRoot)
		return c.Next()
	}
}

func extractToken(c fiber.Ctx) (string, bool) {
	if cookie := c.Cookies(authCookieName); cookie != "" {
		return cookie, true
	}
	authz := c.Get("Authorization")
	if strings.HasPrefix(authz, "Bearer ") {
		return strings.TrimPrefix(authz, "Bearer "), true
	}
	return "", false
}

// Timeout bounds how long any single request may run, and — because the
// deadline rides on the context stored via SetContext — also bounds the DB
// queries and outbound Outline calls that request makes (handlers read it
// back via c.Context()).
//
// fasthttp's request context doesn't support real cancellation the way
// net/http's does (see fiber.Ctx.Done's doc comment), so this deadline is
// enforced by the DB/HTTP clients honoring context.Context, not by fasthttp
// itself aborting the connection.
func Timeout(d time.Duration) fiber.Handler {
	return func(c fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(context.Background(), d)
		defer cancel()
		c.SetContext(ctx)
		return c.Next()
	}
}
