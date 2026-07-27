package outline

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 64 hex chars, the length of a SHA-256 fingerprint.
var validFingerprint = strings.Repeat("ab", 32)

func TestNormalizeFingerprint(t *testing.T) {
	got := NormalizeFingerprint(" AB:CD:ef 01 ")
	if got != "abcdef01" {
		t.Fatalf("NormalizeFingerprint = %q, want %q", got, "abcdef01")
	}
}

func TestNewRejectsBadInput(t *testing.T) {
	tests := []struct {
		name       string
		apiURL     string
		certSHA256 string
	}{
		{"missing scheme", "example.com:1234/secret", validFingerprint},
		{"short fingerprint", "https://example.com:1234/secret", "abcd"},
		{"non-hex fingerprint", "https://example.com:1234/secret", strings.Repeat("z", 64)},
		{"empty fingerprint", "https://example.com:1234/secret", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := New(tc.apiURL, tc.certSHA256, time.Second); err == nil {
				t.Fatal("New() = nil error, want rejection")
			}
		})
	}
}

func TestNewAcceptsColonSeparatedFingerprint(t *testing.T) {
	var parts []string
	for i := 0; i < 32; i++ {
		parts = append(parts, "AB")
	}
	if _, err := New("https://example.com:1234/secret", strings.Join(parts, ":"), time.Second); err != nil {
		t.Fatalf("New() error = %v, want nil", err)
	}
}

func TestNewTrimsTrailingSlash(t *testing.T) {
	c, err := New("https://example.com:1234/secret/", validFingerprint, time.Second)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if c.baseURL != "https://example.com:1234/secret" {
		t.Fatalf("baseURL = %q, want no trailing slash", c.baseURL)
	}
}

// TestSetDataLimitSendsNestedBody guards against a regression where the
// request body was a flat {"bytes": N}. The real Outline API only accepts
// bytes nested under "limit" and 400s on the flat shape, which meant the
// limit was silently never enforced server-side even though our own DB and
// UI believed it had been applied.
func TestSetDataLimitSendsNestedBody(t *testing.T) {
	var gotBody string
	var gotPath string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	sum := sha256.Sum256(srv.Certificate().Raw)
	fingerprint := hex.EncodeToString(sum[:])

	c, err := New(srv.URL, fingerprint, time.Second)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if err := c.SetDataLimit(context.Background(), "42", 3_000_000_000); err != nil {
		t.Fatalf("SetDataLimit() error = %v", err)
	}

	if gotPath != "/access-keys/42/data-limit" {
		t.Fatalf("path = %q, want /access-keys/42/data-limit", gotPath)
	}
	want := `{"limit":{"bytes":3000000000}}`
	if gotBody != want {
		t.Fatalf("body = %q, want %q", gotBody, want)
	}
}
