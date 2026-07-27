package handlers

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
	"outline-manager/internal/authn"
	"outline-manager/internal/models"
	"outline-manager/internal/repository"
)

const authCookieName = "auth_token"

type requestOTPRequest struct {
	Email string `json:"email" validate:"required,email"`
}

// requestOTP validates the email against admin_users, generates a 6-digit
// code, and emails it. The response is deliberately the same shape whether or
// not the email exists is irrelevant here — the spec calls for validating
// against admin_users, so an unknown email is reported as a field error
// rather than silently accepted.
func (a *API) requestOTP(c fiber.Ctx) error {
	var req requestOTPRequest
	if !bindJSON(c, &req) {
		return nil
	}
	email := normalizeEmail(req.Email)

	admin, err := a.repo.GetAdminByEmail(c.Context(), email)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "email", Message: "This email is not a registered admin"})
		}
		return apiresponse.Internal(c, "")
	}
	if admin.Status == models.AdminStatusSuspended {
		return apiresponse.Forbidden(c, "This admin account has been suspended")
	}

	code, err := authn.GenerateOTP()
	if err != nil {
		return apiresponse.Internal(c, "")
	}

	if err := a.repo.CreateOTP(c.Context(), email, authn.HashOTP(code), time.Now().Add(a.cfg.OTPTTL)); err != nil {
		return apiresponse.Internal(c, "")
	}
	go func() {
		if err := a.repo.PruneExpiredOTPs(context.Background()); err != nil {
			log.Printf("prune expired otps: %v", err)
		}
	}()

	// Fire-and-forget: the response doesn't wait on SMTP. A delivery failure
	// is only logged — the user recovers by requesting a new code.
	go func() {
		if err := authn.SendOTPEmail(a.smtpConfig(), email, code, int(a.cfg.OTPTTL.Minutes()), a.cfg.SMTPTimeout); err != nil {
			log.Printf("send otp email to %s: %v", email, err)
		}
	}()

	return apiresponse.Success(c, fiber.Map{
		"email":            email,
		"expiresInSeconds": int(a.cfg.OTPTTL.Seconds()),
	}, "Verification code sent to your email")
}

type verifyOTPRequest struct {
	Email string `json:"email" validate:"required,email"`
	Code  string `json:"code" validate:"required,len=6"`
}

func (a *API) verifyOTP(c fiber.Ctx) error {
	var req verifyOTPRequest
	if !bindJSON(c, &req) {
		return nil
	}
	email := normalizeEmail(req.Email)

	otp, err := a.repo.LatestOTP(c.Context(), email)
	if err != nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "code", Message: "No active code for this email — request a new one"})
	}
	if time.Now().After(otp.ExpiresAt) {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "code", Message: "This code has expired — request a new one"})
	}
	if otp.Attempts >= a.cfg.OTPMaxAttempts {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "code", Message: "Too many incorrect attempts — request a new code"})
	}
	if !authn.VerifyOTP(req.Code, otp.CodeHash) {
		_ = a.repo.IncrementOTPAttempts(c.Context(), otp.ID)
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "code", Message: "Incorrect code"})
	}
	if err := a.repo.ConsumeOTP(c.Context(), otp.ID); err != nil {
		return apiresponse.Internal(c, "")
	}

	admin, err := a.repo.GetAdminByEmail(c.Context(), email)
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	if admin.Status == models.AdminStatusSuspended {
		return apiresponse.Forbidden(c, "This admin account has been suspended")
	}
	admin.IsRoot = a.isRootAdmin(admin.Email)

	token, err := authn.NewToken(a.cfg.JWTSecret, admin.Email, admin.IsRoot, a.cfg.JWTTTL)
	if err != nil {
		return apiresponse.Internal(c, "")
	}

	a.setAuthCookie(c, token)
	return apiresponse.Success(c, fiber.Map{"admin": admin, "token": token}, "Signed in successfully")
}

func (a *API) logout(c fiber.Ctx) error {
	a.clearAuthCookie(c)
	return apiresponse.NoContentOK(c, "Signed out")
}

func (a *API) me(c fiber.Ctx) error {
	email, _ := c.Locals(ctxKeyEmail).(string)
	admin, err := a.repo.GetAdminByEmail(c.Context(), email)
	if err != nil {
		return respondRepoErr(c, err)
	}
	admin.IsRoot = a.isRootAdmin(admin.Email)
	return apiresponse.Success(c, admin, "")
}

func (a *API) setAuthCookie(c fiber.Ctx, token string) {
	c.Cookie(&fiber.Cookie{
		Name:     authCookieName,
		Value:    token,
		Path:     "/",
		Domain:   a.cfg.CookieDomain,
		MaxAge:   int(a.cfg.JWTTTL.Seconds()),
		Secure:   a.cfg.CookieSecure,
		HTTPOnly: true,
		SameSite: fiber.CookieSameSiteLaxMode,
	})
}

func (a *API) clearAuthCookie(c fiber.Ctx) {
	c.Cookie(&fiber.Cookie{
		Name:     authCookieName,
		Value:    "",
		Path:     "/",
		Domain:   a.cfg.CookieDomain,
		MaxAge:   -1,
		Secure:   a.cfg.CookieSecure,
		HTTPOnly: true,
		SameSite: fiber.CookieSameSiteLaxMode,
	})
}

func (a *API) smtpConfig() authn.SMTPConfig {
	return authn.SMTPConfig{
		Host:      a.cfg.SMTPHost,
		Port:      a.cfg.SMTPPort,
		Username:  a.cfg.SMTPUsername,
		Password:  a.cfg.SMTPPassword,
		FromEmail: a.cfg.SMTPFromEmail,
		FromName:  a.cfg.SMTPFromName,
	}
}

func (a *API) isRootAdmin(email string) bool {
	return strings.EqualFold(email, a.cfg.RootAdminEmail)
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
