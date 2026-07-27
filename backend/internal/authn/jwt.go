// Package authn implements admin authentication: JWT session tokens, OTP
// generation/hashing, and the transactional email that delivers the OTP.
package authn

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims is the JWT payload for an authenticated admin session.
type Claims struct {
	Email  string `json:"email"`
	IsRoot bool   `json:"isRoot"`
	jwt.RegisteredClaims
}

// NewToken signs a session JWT for email, valid for ttl.
func NewToken(secret string, email string, isRoot bool, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		Email:  email,
		IsRoot: isRoot,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			Subject:   email,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseToken validates a session JWT and returns its claims.
func ParseToken(secret string, raw string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}
