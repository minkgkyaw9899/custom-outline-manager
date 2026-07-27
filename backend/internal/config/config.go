// Package config loads runtime configuration from environment variables.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port               string
	DatabaseURL        string
	CronInterval       time.Duration
	StaticDir          string
	RequestTimeout     time.Duration
	OutlineHTTPTimeout time.Duration

	// AllowedOrigins enables CORS for a separately-hosted frontend (e.g. the
	// React dev server). Empty means no CORS headers are sent, which is the
	// right default when the API also serves the UI out of StaticDir.
	AllowedOrigins []string

	// PublicBaseURL is this server's own public host[:port], with no scheme
	// and no trailing slash (e.g. "vpn.example.com"). It is only used to build
	// ssconf:// dynamic access key links (see internal/handlers/dynamic_key.go)
	// that point back at this server's own /api/v1/dkey/:token endpoint.
	// Empty disables the dynamic-key feature: keys fall back to sharing their
	// static ss:// link. Explicit config rather than inferring it from the
	// request Host header, matching AllowedOrigins' explicit-list approach
	// elsewhere in this file — an inferred host is spoofable by whoever sends
	// the request.
	PublicBaseURL string

	// RootAdminEmail is the single immutable super-admin. It can never be
	// deleted, suspended, or demoted through the API, regardless of who asks.
	RootAdminEmail string

	// JWTSecret signs the auth cookie/bearer token. Required in production;
	// Load generates an ephemeral one (with a loud warning) if unset, so local
	// dev doesn't hard-fail but every restart invalidates existing sessions.
	JWTSecret      string
	JWTTTL         time.Duration
	OTPTTL         time.Duration
	OTPMaxAttempts int

	// Share-view link settings: the public, passcode-gated per-key status page
	// (see internal/handlers/share.go). ShareTokenTTL is the "1 day" access
	// window from the spec — how long a correct passcode keeps the holder
	// signed in before they must re-enter it.
	ShareTokenTTL     time.Duration
	ShareMaxAttempts  int
	ShareLockDuration time.Duration

	// CookieSecure should be true in production (HTTPS). Off by default so
	// plain-HTTP local dev still gets the cookie set.
	CookieSecure bool
	CookieDomain string

	SMTPHost      string
	SMTPPort      int
	SMTPUsername  string
	SMTPPassword  string
	SMTPFromEmail string
	SMTPFromName  string
	// SMTPTimeout bounds each phase of the send (dial, then handshake+auth,
	// then data) so a stalled connection fails fast instead of hanging the
	// request goroutine, and a slow handshake can't starve the data phase.
	SMTPTimeout time.Duration
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:               getEnv("PORT", "8080"),
		DatabaseURL:        getEnv("DATABASE_URL", ""),
		StaticDir:          getEnv("STATIC_DIR", "../frontend"),
		CronInterval:       getDurationEnv("CRON_INTERVAL", 30*time.Minute),
		RequestTimeout:     getDurationEnv("REQUEST_TIMEOUT", 15*time.Second),
		OutlineHTTPTimeout: getDurationEnv("OUTLINE_HTTP_TIMEOUT", 10*time.Second),
		AllowedOrigins:     getListEnv("ALLOWED_ORIGINS"),
		PublicBaseURL:      normalizeBaseURL(getEnv("PUBLIC_BASE_URL", "")),

		RootAdminEmail: strings.ToLower(strings.TrimSpace(getEnv("ROOT_ADMIN_EMAIL", "minkgkyaw9899@gmail.com"))),

		JWTSecret:      getEnv("JWT_SECRET", ""),
		JWTTTL:         getDurationEnv("JWT_TTL", 7*24*time.Hour),
		OTPTTL:         getDurationEnv("OTP_TTL", 10*time.Minute),
		OTPMaxAttempts: getIntEnv("OTP_MAX_ATTEMPTS", 5),

		ShareTokenTTL:     getDurationEnv("SHARE_TOKEN_TTL", 24*time.Hour),
		ShareMaxAttempts:  getIntEnv("SHARE_MAX_ATTEMPTS", 5),
		ShareLockDuration: getDurationEnv("SHARE_LOCK_DURATION", 15*time.Minute),

		CookieSecure: getEnv("COOKIE_SECURE", "false") == "true",
		CookieDomain: getEnv("COOKIE_DOMAIN", ""),

		SMTPHost:      getEnv("SMTP_HOST", "smtp.gmail.com"),
		SMTPPort:      getIntEnv("SMTP_PORT", 587),
		SMTPUsername:  getEnv("SMTP_USERNAME", "minkgkyaw1999@gmail.com"),
		SMTPPassword:  getEnv("SMTP_PASSWORD", ""),
		SMTPFromEmail: getEnv("SMTP_FROM_EMAIL", "minkgkyaw1999@gmail.com"),
		SMTPFromName:  getEnv("SMTP_FROM_NAME", "Invisigate VPN"),
		SMTPTimeout:   getDurationEnv("SMTP_TIMEOUT", 15*time.Second),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	if cfg.JWTSecret == "" {
		generated, err := randomSecret(32)
		if err != nil {
			return nil, fmt.Errorf("generate fallback JWT secret: %w", err)
		}
		cfg.JWTSecret = generated
		log.Println("WARNING: JWT_SECRET is not set; using a randomly generated secret for this process. " +
			"All sessions will be invalidated on restart. Set JWT_SECRET in production.")
	}

	return cfg, nil
}

func randomSecret(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func getIntEnv(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func getDurationEnv(key string, fallback time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

// normalizeBaseURL accepts PUBLIC_BASE_URL with or without a scheme (an
// operator will naturally type "https://vpn.example.com") and strips it down
// to bare host[:port], since ssconf:// links are built by prefixing a scheme
// of their own. A trailing slash is trimmed the same way.
func normalizeBaseURL(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	return strings.TrimRight(s, "/")
}

// getListEnv parses a comma-separated env var into a slice, dropping blanks.
func getListEnv(key string) []string {
	raw := os.Getenv(key)
	if raw == "" {
		return nil
	}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}
