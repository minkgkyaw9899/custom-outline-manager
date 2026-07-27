package authn

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// GenerateSlug returns a URL-safe random identifier for a share link. 16
// random bytes gives 128 bits of entropy, plenty to make the link
// unguessable even though it isn't itself treated as the sole secret (the
// passcode is what actually gates access).
func GenerateSlug() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// ShareClaims is the JWT payload for a key holder's share-view session,
// issued after they set up or correctly re-enter their passcode.
type ShareClaims struct {
	Slug   string `json:"slug"`
	UserID string `json:"userId"`
	jwt.RegisteredClaims
}

// NewShareToken signs a share-view session JWT, valid for ttl (one day by
// default — see config.ShareTokenTTL).
func NewShareToken(secret, slug, userID string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := ShareClaims{
		Slug:   slug,
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			Subject:   slug,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseShareToken validates a share-view session JWT and returns its claims.
func ParseShareToken(secret string, raw string) (*ShareClaims, error) {
	claims := &ShareClaims{}
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
