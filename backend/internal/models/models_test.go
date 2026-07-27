package models

import (
	"testing"
	"time"
)

func ptrInt64(v int64) *int64        { return &v }
func ptrTime(t time.Time) *time.Time { return &t }

var now = time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)

func TestDeriveKeyStatus(t *testing.T) {
	tests := []struct {
		name        string
		endDate     *time.Time
		limitBytes  *int64
		usedBytes   int64
		dbEnabled   bool
		wantStatus  KeyStatus
		wantEnabled bool
	}{
		{
			name:        "no limits at all is active",
			dbEnabled:   true,
			wantStatus:  StatusActive,
			wantEnabled: true,
		},
		{
			name:        "within quota and date",
			endDate:     ptrTime(now.AddDate(0, 0, 5)),
			limitBytes:  ptrInt64(10 * BytesPerGB),
			usedBytes:   3 * BytesPerGB,
			dbEnabled:   true,
			wantStatus:  StatusActive,
			wantEnabled: true,
		},
		{
			name:        "past end date expires",
			endDate:     ptrTime(now.Add(-time.Minute)),
			dbEnabled:   true,
			wantStatus:  StatusExpired,
			wantEnabled: false,
		},
		{
			name:        "usage exactly at the ceiling counts as exceeded",
			limitBytes:  ptrInt64(5 * BytesPerGB),
			usedBytes:   5 * BytesPerGB,
			dbEnabled:   true,
			wantStatus:  StatusLimitExceeded,
			wantEnabled: false,
		},
		{
			name:        "expiry wins over quota when both are blown",
			endDate:     ptrTime(now.Add(-time.Hour)),
			limitBytes:  ptrInt64(BytesPerGB),
			usedBytes:   2 * BytesPerGB,
			dbEnabled:   true,
			wantStatus:  StatusExpired,
			wantEnabled: false,
		},
		{
			name:        "in bounds but disabled in db reports disabled and wants re-enabling",
			endDate:     ptrTime(now.AddDate(0, 0, 3)),
			limitBytes:  ptrInt64(10 * BytesPerGB),
			usedBytes:   BytesPerGB,
			dbEnabled:   false,
			wantStatus:  StatusDisabled,
			wantEnabled: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			status, _, _, enabled := DeriveKeyStatus(now, tc.endDate, tc.limitBytes, tc.usedBytes, tc.dbEnabled)
			if status != tc.wantStatus {
				t.Errorf("status = %q, want %q", status, tc.wantStatus)
			}
			if enabled != tc.wantEnabled {
				t.Errorf("shouldBeEnabled = %v, want %v", enabled, tc.wantEnabled)
			}
		})
	}
}

func TestDeriveKeyStatusDerivedFields(t *testing.T) {
	t.Run("days left rounds partial days up", func(t *testing.T) {
		_, daysLeft, _, _ := DeriveKeyStatus(now, ptrTime(now.Add(6*time.Hour)), nil, 0, true)
		if daysLeft == nil || *daysLeft != 1 {
			t.Fatalf("daysLeft = %v, want 1", daysLeft)
		}
	})

	t.Run("days left never goes negative", func(t *testing.T) {
		_, daysLeft, _, _ := DeriveKeyStatus(now, ptrTime(now.AddDate(0, 0, -10)), nil, 0, true)
		if daysLeft == nil || *daysLeft != 0 {
			t.Fatalf("daysLeft = %v, want 0", daysLeft)
		}
	})

	t.Run("nil end date yields nil days left", func(t *testing.T) {
		_, daysLeft, _, _ := DeriveKeyStatus(now, nil, nil, 0, true)
		if daysLeft != nil {
			t.Fatalf("daysLeft = %v, want nil", *daysLeft)
		}
	})

	t.Run("remaining bytes clamps at zero when over quota", func(t *testing.T) {
		_, _, remaining, _ := DeriveKeyStatus(now, nil, ptrInt64(BytesPerGB), 3*BytesPerGB, true)
		if remaining == nil || *remaining != 0 {
			t.Fatalf("remainingBytes = %v, want 0", remaining)
		}
	})
}

func TestRenewalTarget(t *testing.T) {
	t.Run("quota top-up is relative to bytes already used", func(t *testing.T) {
		key := Key{UsedBytes: 7 * BytesPerGB, CustomLimitBytes: ptrInt64(10 * BytesPerGB)}
		limit, _ := RenewalTarget(now, key, 5, 0)
		if want := int64(12 * BytesPerGB); limit == nil || *limit != want {
			t.Fatalf("limit = %v, want %d (used + 5GB of fresh headroom)", limit, want)
		}
	})

	t.Run("top-up on an unlimited key sets a ceiling", func(t *testing.T) {
		limit, _ := RenewalTarget(now, Key{UsedBytes: 2 * BytesPerGB}, 1, 0)
		if want := int64(3 * BytesPerGB); limit == nil || *limit != want {
			t.Fatalf("limit = %v, want %d", limit, want)
		}
	})

	t.Run("renewing early extends from the existing end date", func(t *testing.T) {
		future := now.AddDate(0, 0, 10)
		_, end := RenewalTarget(now, Key{EndDate: &future}, 0, 30)
		if want := future.AddDate(0, 0, 30); end == nil || !end.Equal(want) {
			t.Fatalf("endDate = %v, want %v", end, want)
		}
	})

	t.Run("renewing an expired key extends from today", func(t *testing.T) {
		past := now.AddDate(0, 0, -10)
		_, end := RenewalTarget(now, Key{EndDate: &past}, 0, 30)
		if want := now.AddDate(0, 0, 30); end == nil || !end.Equal(want) {
			t.Fatalf("endDate = %v, want %v", end, want)
		}
	})

	t.Run("zero values leave both dimensions untouched", func(t *testing.T) {
		future := now.AddDate(0, 0, 3)
		key := Key{CustomLimitBytes: ptrInt64(BytesPerGB), EndDate: &future}
		limit, end := RenewalTarget(now, key, 0, 0)
		if limit != key.CustomLimitBytes || end != key.EndDate {
			t.Fatalf("limit/end = %v/%v, want unchanged", limit, end)
		}
	})
}

func TestEnrichKeysReturnsEmptySliceNotNil(t *testing.T) {
	if got := EnrichKeys(now, nil); got == nil {
		t.Fatal("EnrichKeys(nil) = nil, want empty slice so JSON encodes as []")
	}
}
