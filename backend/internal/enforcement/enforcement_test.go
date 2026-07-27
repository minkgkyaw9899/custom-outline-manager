package enforcement

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"outline-manager/internal/models"
	"outline-manager/internal/outline"
)

func TestUsageForKey(t *testing.T) {
	metrics := &outline.MetricsTransfer{BytesTransferredByUserID: map[string]int64{
		"0":  10,
		"3":  30,
		"ab": 99,
	}}

	tests := []struct {
		name         string
		outlineKeyID string
		want         int64
	}{
		{"exact match", "3", 30},
		{"non-numeric id", "ab", 99},
		{"leading zeros normalized to the numeric form", "003", 30},
		{"zero id", "0", 10},
		{"unknown key reports no usage", "42", 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := usageForKey(metrics, tc.outlineKeyID); got != tc.want {
				t.Errorf("usageForKey(%q) = %d, want %d", tc.outlineKeyID, got, tc.want)
			}
		})
	}
}

func TestSumTransfer(t *testing.T) {
	m := &outline.MetricsTransfer{BytesTransferredByUserID: map[string]int64{"1": 5, "2": 7}}
	if got := sumTransfer(m); got != 12 {
		t.Fatalf("sumTransfer = %d, want 12", got)
	}
	if got := sumTransfer(&outline.MetricsTransfer{}); got != 0 {
		t.Fatalf("sumTransfer(empty) = %d, want 0", got)
	}
}

// capturedRequest records the single HTTP request a fakeOutlineServer sees so
// a test can assert on the exact wire protocol the reconciler sent.
type capturedRequest struct {
	method string
	path   string
	body   string
}

// fakeOutlineServer stands in for a real Outline server: a TLS endpoint
// pinned the same way the real client pins one, so reconcileKey can be
// exercised through an actual *outline.Client rather than a mock, and any
// mismatch with Outline's real wire protocol (e.g. an unwrapped request body)
// shows up here instead of only in production.
func fakeOutlineServer(t *testing.T) (*outline.Client, *capturedRequest) {
	t.Helper()
	captured := &capturedRequest{}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		captured.method = r.Method
		captured.path = r.URL.Path
		captured.body = string(body)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	sum := sha256.Sum256(srv.Certificate().Raw)
	fingerprint := hex.EncodeToString(sum[:])

	client, err := outline.New(srv.URL, fingerprint, time.Second)
	if err != nil {
		t.Fatalf("outline.New() error = %v", err)
	}
	return client, captured
}

// TestReconcileKeyPushesCorrectOutlineState is a regression test for a bug
// where reconcileKey called client.SetDataLimit with the right value, but the
// client itself serialized it as a bare {"bytes": N}, a shape Outline's API
// rejects (it requires bytes nested under "limit"). Every push silently
// failed: the DB and dashboard believed a key was capped or disabled while
// Outline kept enforcing no limit at all. Each case here is built so
// key.Enabled/key.Status already match the derived state, which keeps
// reconcileKey from touching the repository (untestable here without a real
// DB) while still exercising every branch that talks to Outline.
func TestReconcileKeyPushesCorrectOutlineState(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name       string
		key        models.Key
		wantMethod string
		wantPath   string
		wantBody   string // empty for a bodyless DELETE
	}{
		{
			name: "over quota disables with a zero-byte limit",
			key: models.Key{
				OutlineKeyID:     "18",
				CustomLimitBytes: int64Ptr(4 * models.BytesPerGB),
				UsedBytes:        5 * models.BytesPerGB,
				Enabled:          false,
				Status:           models.StatusLimitExceeded,
			},
			wantMethod: http.MethodPut,
			wantPath:   "/access-keys/18/data-limit",
			wantBody:   `{"limit":{"bytes":0}}`,
		},
		{
			name: "expired disables with a zero-byte limit",
			key: models.Key{
				OutlineKeyID: "19",
				EndDate:      timePtr(now.Add(-time.Hour)),
				Enabled:      false,
				Status:       models.StatusExpired,
			},
			wantMethod: http.MethodPut,
			wantPath:   "/access-keys/19/data-limit",
			wantBody:   `{"limit":{"bytes":0}}`,
		},
		{
			name: "active key with a custom limit pushes that ceiling",
			key: models.Key{
				OutlineKeyID:     "1",
				CustomLimitBytes: int64Ptr(200 * models.BytesPerGB),
				UsedBytes:        8 * models.BytesPerGB,
				Enabled:          true,
				Status:           models.StatusActive,
			},
			wantMethod: http.MethodPut,
			wantPath:   "/access-keys/1/data-limit",
			wantBody:   `{"limit":{"bytes":200000000000}}`,
		},
		{
			name: "active key with no custom limit removes any limit",
			key: models.Key{
				OutlineKeyID: "2",
				Enabled:      true,
				Status:       models.StatusActive,
			},
			wantMethod: http.MethodDelete,
			wantPath:   "/access-keys/2/data-limit",
			wantBody:   "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			client, captured := fakeOutlineServer(t)
			e := &Enforcer{}
			if err := e.reconcileKey(context.Background(), client, tc.key); err != nil {
				t.Fatalf("reconcileKey() error = %v", err)
			}
			if captured.method != tc.wantMethod {
				t.Errorf("method = %q, want %q", captured.method, tc.wantMethod)
			}
			if captured.path != tc.wantPath {
				t.Errorf("path = %q, want %q", captured.path, tc.wantPath)
			}
			if captured.body != tc.wantBody {
				t.Errorf("body = %q, want %q", captured.body, tc.wantBody)
			}
		})
	}
}

func int64Ptr(v int64) *int64        { return &v }
func timePtr(t time.Time) *time.Time { return &t }
