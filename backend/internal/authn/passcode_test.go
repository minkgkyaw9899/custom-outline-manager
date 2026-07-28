package authn

import "testing"

func TestVerifyPasscodeBcrypt(t *testing.T) {
	hash, err := HashPasscode("123456")
	if err != nil {
		t.Fatalf("HashPasscode() error = %v", err)
	}

	ok, needsRehash := VerifyPasscode("123456", hash)
	if !ok {
		t.Error("VerifyPasscode() ok = false for correct code, want true")
	}
	if needsRehash {
		t.Error("VerifyPasscode() needsRehash = true for a bcrypt hash, want false")
	}

	ok, _ = VerifyPasscode("654321", hash)
	if ok {
		t.Error("VerifyPasscode() ok = true for incorrect code, want false")
	}
}

func TestVerifyPasscodeLegacySHA256(t *testing.T) {
	legacyHash := HashOTP("123456")

	ok, needsRehash := VerifyPasscode("123456", legacyHash)
	if !ok {
		t.Error("VerifyPasscode() ok = false for correct legacy code, want true")
	}
	if !needsRehash {
		t.Error("VerifyPasscode() needsRehash = false for a legacy SHA-256 hash, want true")
	}

	ok, needsRehash = VerifyPasscode("654321", legacyHash)
	if ok {
		t.Error("VerifyPasscode() ok = true for incorrect legacy code, want false")
	}
	if !needsRehash {
		t.Error("VerifyPasscode() needsRehash = false for a legacy SHA-256 hash, want true")
	}
}
