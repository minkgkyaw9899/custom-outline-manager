package handlers

import "testing"

// Every key is sold as at least one 200 GB / 30 day plan period, so an empty
// allowance means one period rather than "no quota, no expiry".
func TestApplyPlanMinimums(t *testing.T) {
	t.Run("zero becomes one plan period", func(t *testing.T) {
		gb, days := 0.0, 0
		if err := applyPlanMinimums(&gb, &days); err != nil {
			t.Fatalf("unexpected error: %v", err.Message)
		}
		if gb != 200 || days != 30 {
			t.Fatalf("got %v GB / %d days, want 200 / 30", gb, days)
		}
	})

	t.Run("a larger allowance is left alone", func(t *testing.T) {
		gb, days := 500.0, 365
		if err := applyPlanMinimums(&gb, &days); err != nil {
			t.Fatalf("unexpected error: %v", err.Message)
		}
		if gb != 500 || days != 365 {
			t.Fatalf("got %v GB / %d days, want 500 / 365", gb, days)
		}
	})

	// Rounding a too-small request up would silently sell a bigger plan than
	// was asked for, so it is rejected instead.
	t.Run("below the floor is rejected, not rounded", func(t *testing.T) {
		gb, days := 50.0, 30
		err := applyPlanMinimums(&gb, &days)
		if err == nil || err.Field != "add_gb" {
			t.Fatalf("want an add_gb validation error, got %+v", err)
		}

		gb, days = 200.0, 7
		err = applyPlanMinimums(&gb, &days)
		if err == nil || err.Field != "add_days" {
			t.Fatalf("want an add_days validation error, got %+v", err)
		}
	})

	t.Run("negative is rejected", func(t *testing.T) {
		gb, days := -1.0, 30
		if err := applyPlanMinimums(&gb, &days); err == nil {
			t.Fatal("want a validation error for a negative allowance")
		}
	})
}

// The manual override takes either a plain date or a full timestamp; a plain
// date means the key works through the end of that day, not until it begins.
func TestParseEndDate(t *testing.T) {
	t.Run("a plain date lands at the end of the day", func(t *testing.T) {
		got, err := parseEndDate("2026-08-24")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if want := "2026-08-24T23:59:59Z"; got.UTC().Format("2006-01-02T15:04:05Z") != want {
			t.Fatalf("got %s, want %s", got.UTC().Format("2006-01-02T15:04:05Z"), want)
		}
	})

	t.Run("an RFC3339 timestamp is kept exactly", func(t *testing.T) {
		got, err := parseEndDate("2026-08-24T17:29:59Z")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got.UTC().Format("2006-01-02T15:04:05Z") != "2026-08-24T17:29:59Z" {
			t.Fatalf("got %s", got.UTC())
		}
	})

	t.Run("anything else is rejected", func(t *testing.T) {
		if _, err := parseEndDate("24/08/2026"); err == nil {
			t.Fatal("want an error for an unparseable date")
		}
	})
}
