package authn

import (
	"testing"
	"time"
)

func TestNewTokenAndParseTokenRoundTrip(t *testing.T) {
	token, err := NewToken("test-secret", "admin@example.com", true, time.Hour)
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}

	claims, err := ParseToken("test-secret", token)
	if err != nil {
		t.Fatalf("ParseToken() error = %v", err)
	}
	if claims.Email != "admin@example.com" {
		t.Errorf("Email = %q, want %q", claims.Email, "admin@example.com")
	}
	if !claims.IsRoot {
		t.Errorf("IsRoot = false, want true")
	}
}

func TestParseTokenRejectsWrongSecret(t *testing.T) {
	token, err := NewToken("right-secret", "admin@example.com", false, time.Hour)
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}
	if _, err := ParseToken("wrong-secret", token); err == nil {
		t.Fatal("ParseToken() with wrong secret = nil error, want rejection")
	}
}

func TestParseTokenRejectsExpiredToken(t *testing.T) {
	token, err := NewToken("test-secret", "admin@example.com", false, -time.Hour)
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}
	if _, err := ParseToken("test-secret", token); err == nil {
		t.Fatal("ParseToken() with expired token = nil error, want rejection")
	}
}
