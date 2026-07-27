package repository

import (
	"context"
	"fmt"
	"time"

	"outline-manager/internal/models"
)

const renewalColumns = `id, key_id, added_gb, added_days, new_limit_bytes, new_end_date, created_at`

func (r *Repository) InsertRenewalLog(ctx context.Context, keyID string, addedGB float64, addedDays int, newLimitBytes *int64, newEndDate *time.Time) (*models.RenewalLog, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO renewal_logs (key_id, added_gb, added_days, new_limit_bytes, new_end_date)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+renewalColumns, keyID, addedGB, addedDays, newLimitBytes, newEndDate)

	var l models.RenewalLog
	if err := row.Scan(&l.ID, &l.KeyID, &l.AddedGB, &l.AddedDays, &l.NewLimitBytes, &l.NewEndDate, &l.CreatedAt); err != nil {
		return nil, fmt.Errorf("insert renewal log: %w", err)
	}
	return &l, nil
}

func (r *Repository) ListRenewalLogs(ctx context.Context, keyID string) ([]models.RenewalLog, error) {
	if !isUUID(keyID) {
		return nil, ErrNotFound
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+renewalColumns+`
		FROM renewal_logs WHERE key_id = $1 ORDER BY created_at DESC
	`, keyID)
	if err != nil {
		return nil, fmt.Errorf("list renewal logs: %w", err)
	}
	defer rows.Close()

	out := make([]models.RenewalLog, 0)
	for rows.Next() {
		var l models.RenewalLog
		if err := rows.Scan(&l.ID, &l.KeyID, &l.AddedGB, &l.AddedDays, &l.NewLimitBytes, &l.NewEndDate, &l.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan renewal log: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}
