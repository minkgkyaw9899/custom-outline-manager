package main

import (
	"fmt"
	"os"
	"time"

	"outline-manager/internal/authn"
)

// Scratch program for manual verification only — mints an admin session JWT
// using JWT_SECRET so endpoints can be curl'd without needing SMTP-delivered
// OTP login. Not part of the feature; removed after testing.
func main() {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		panic("JWT_SECRET env var required")
	}
	token, err := authn.NewToken(secret, "minkgkyaw9899@gmail.com", true, time.Hour)
	if err != nil {
		panic(err)
	}
	fmt.Println(token)
}
