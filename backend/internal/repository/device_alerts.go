package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// DeviceAlertSentAt returns when a key was last flagged for exceeding the
// device-count threshold, or nil if it never has been.
func (r *Repository) DeviceAlertSentAt(ctx context.Context, keyID string) (*time.Time, error) {
	var t time.Time
	err := r.pool.QueryRow(ctx, `SELECT sent_at FROM device_alerts WHERE key_id = $1`, keyID).Scan(&t)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("device alert sent at: %w", err)
	}
	return &t, nil
}

// SetDeviceAlertSentAt records that a key was just flagged, so the next
// sweep's debounce window skips it until it elapses.
func (r *Repository) SetDeviceAlertSentAt(ctx context.Context, keyID string, sentAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO device_alerts (key_id, sent_at) VALUES ($1, $2)
		ON CONFLICT (key_id) DO UPDATE SET sent_at = EXCLUDED.sent_at
	`, keyID, sentAt)
	if err != nil {
		return fmt.Errorf("set device alert sent at: %w", err)
	}
	return nil
}
