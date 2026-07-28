package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"outline-manager/internal/models"
)

const renewalColumns = `id, key_id, added_gb, added_days, new_limit_bytes, new_end_date, created_at, paid, payment_note`

func (r *Repository) InsertRenewalLog(ctx context.Context, keyID string, addedGB float64, addedDays int, newLimitBytes *int64, newEndDate *time.Time, paid bool, paymentNote *string) (*models.RenewalLog, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO renewal_logs (key_id, added_gb, added_days, new_limit_bytes, new_end_date, paid, payment_note)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+renewalColumns, keyID, addedGB, addedDays, newLimitBytes, newEndDate, paid, paymentNote)

	var l models.RenewalLog
	if err := row.Scan(&l.ID, &l.KeyID, &l.AddedGB, &l.AddedDays, &l.NewLimitBytes, &l.NewEndDate, &l.CreatedAt, &l.Paid, &l.PaymentNote); err != nil {
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
		if err := rows.Scan(&l.ID, &l.KeyID, &l.AddedGB, &l.AddedDays, &l.NewLimitBytes, &l.NewEndDate, &l.CreatedAt, &l.Paid, &l.PaymentNote); err != nil {
			return nil, fmt.Errorf("scan renewal log: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// UpdateRenewalPayment corrects a renewal's payment status after the fact —
// e.g. an auto-renewal logged unpaid gets marked paid once the admin
// confirms the transfer, or a note gets added/edited.
func (r *Repository) UpdateRenewalPayment(ctx context.Context, id string, paid bool, paymentNote *string) (*models.RenewalLog, error) {
	if !isUUID(id) {
		return nil, ErrNotFound
	}
	row := r.pool.QueryRow(ctx, `
		UPDATE renewal_logs SET paid = $2, payment_note = $3
		WHERE id = $1
		RETURNING `+renewalColumns, id, paid, paymentNote)

	var l models.RenewalLog
	if err := row.Scan(&l.ID, &l.KeyID, &l.AddedGB, &l.AddedDays, &l.NewLimitBytes, &l.NewEndDate, &l.CreatedAt, &l.Paid, &l.PaymentNote); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("update renewal payment: %w", err)
	}
	return &l, nil
}
