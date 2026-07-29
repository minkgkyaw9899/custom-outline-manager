package repository

import (
	"context"
	"fmt"
	"time"
)

type OTPCode struct {
	ID         string
	Email      string
	CodeHash   string
	ExpiresAt  time.Time
	Attempts   int
	ConsumedAt *time.Time
	CreatedAt  time.Time
}

func (r *Repository) CreateOTP(ctx context.Context, email, codeHash string, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO otp_codes (email, code_hash, expires_at) VALUES ($1, $2, $3)
	`, email, codeHash, expiresAt)
	if err != nil {
		return fmt.Errorf("create otp: %w", err)
	}
	return nil
}

// LatestOTP returns the most recent unconsumed OTP for email, or ErrNotFound.
func (r *Repository) LatestOTP(ctx context.Context, email string) (*OTPCode, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, email, code_hash, expires_at, attempts, consumed_at, created_at
		FROM otp_codes
		WHERE email = $1 AND consumed_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1
	`, email)

	var o OTPCode
	if err := row.Scan(&o.ID, &o.Email, &o.CodeHash, &o.ExpiresAt, &o.Attempts, &o.ConsumedAt, &o.CreatedAt); err != nil {
		return nil, ErrNotFound
	}
	return &o, nil
}

func (r *Repository) IncrementOTPAttempts(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, id)
	return err
}

func (r *Repository) ConsumeOTP(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, id)
	return err
}

// PruneExpiredOTPs removes stale rows so the table doesn't grow unbounded.
// Best-effort housekeeping, called opportunistically on each OTP request.
func (r *Repository) PruneExpiredOTPs(ctx context.Context) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day'`)
	return err
}
