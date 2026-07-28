package authn

import "golang.org/x/crypto/bcrypt"

// passcodeBcryptCost trades a slightly slower hash for stronger resistance to
// an offline attack on a leaked passcode_hash column. Unlike the OTP codes
// (10-minute TTL, single use — see otp.go), a share-view passcode is a
// long-lived credential the holder reuses indefinitely, so it's worth the
// extra cost; verification only happens on the holder's occasional visits,
// not on every request.
const passcodeBcryptCost = 12

// HashPasscode hashes a share-view passcode for storage.
func HashPasscode(code string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(code), passcodeBcryptCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// isBcryptHash reports whether storedHash looks like a bcrypt hash (all
// supported prefixes: $2a$, $2b$, $2y$) rather than a legacy plain SHA-256
// hex digest from before passcodes moved to bcrypt.
func isBcryptHash(storedHash string) bool {
	return len(storedHash) > 1 && storedHash[0] == '$' && storedHash[1] == '2'
}

// VerifyPasscode checks a submitted passcode against its stored hash,
// transparently supporting both bcrypt hashes and the legacy plain SHA-256
// hashes written before passcodes were migrated to bcrypt (see HashOTP —
// passcodes originally reused that function). needsRehash is true exactly
// when a legacy hash verified correctly, telling the caller to write a fresh
// bcrypt hash for this same passcode so the row is upgraded in place on
// next use, without ever invalidating an existing holder's passcode or
// requiring them to reset it.
func VerifyPasscode(code, storedHash string) (ok bool, needsRehash bool) {
	if isBcryptHash(storedHash) {
		return bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(code)) == nil, false
	}
	// Legacy format: same scheme as OTP codes.
	return VerifyOTP(code, storedHash), true
}
