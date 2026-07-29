package main

import (
	"fmt"
	"os"
	"time"

	"outline-manager/internal/authn"
)

// Scratch program for manual verification only — mints an admin session JWT
// using JWT_SECRET so endpoints can be curl'd without needing SMTP-delivered
// OTP login. Never built into the production image (backend/Dockerfile only
// builds ./cmd/server), but it can still bypass OTP against any DB it's
// pointed at, so running it at all requires an explicit opt-in rather than
// just having JWT_SECRET on hand.
func main() {
	if os.Getenv("ALLOW_GENTOKEN") != "yes" {
		panic("refusing to run: this mints an admin session with no OTP check. " +
			"Set ALLOW_GENTOKEN=yes if you really mean to run this against the target database.")
	}

	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		panic("JWT_SECRET env var required")
	}
	email := os.Getenv("ADMIN_EMAIL")
	if email == "" {
		panic("ADMIN_EMAIL env var required (must match a row in admin_users)")
	}

	token, err := authn.NewToken(secret, email, true, time.Hour)
	if err != nil {
		panic(err)
	}
	fmt.Println(token)
}
