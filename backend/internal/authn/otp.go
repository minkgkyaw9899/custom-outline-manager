package authn

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"math/big"
)

// GenerateOTP returns a cryptographically random 6-digit code, zero-padded.
func GenerateOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// HashOTP hashes a code for storage, so a database read never discloses the
// live code.
func HashOTP(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

// VerifyOTP constant-time compares a submitted code's hash against the stored
// hash, so response timing can't leak how many digits matched.
func VerifyOTP(code, storedHash string) bool {
	got := HashOTP(code)
	return subtle.ConstantTimeCompare([]byte(got), []byte(storedHash)) == 1
}
