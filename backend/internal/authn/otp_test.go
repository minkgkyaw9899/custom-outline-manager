package authn

import "testing"

func TestGenerateOTPIsSixDigits(t *testing.T) {
	for i := 0; i < 50; i++ {
		code, err := GenerateOTP()
		if err != nil {
			t.Fatalf("GenerateOTP() error = %v", err)
		}
		if len(code) != 6 {
			t.Fatalf("GenerateOTP() = %q, want 6 digits", code)
		}
		for _, r := range code {
			if r < '0' || r > '9' {
				t.Fatalf("GenerateOTP() = %q, want all digits", code)
			}
		}
	}
}

func TestVerifyOTP(t *testing.T) {
	hash := HashOTP("123456")

	if !VerifyOTP("123456", hash) {
		t.Error("VerifyOTP() = false for correct code, want true")
	}
	if VerifyOTP("654321", hash) {
		t.Error("VerifyOTP() = true for incorrect code, want false")
	}
}
