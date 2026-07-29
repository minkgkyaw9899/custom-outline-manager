package repository

import (
	"context"
	"fmt"

	"outline-manager/internal/models"
)

const settingsColumns = `mmk_per_usd, payment_phone, payment_wallets, updated_at`

// GetSettings reads the single settings row seeded by migration 0017. The
// row always exists (the migration inserts it and the table's id column
// only ever admits one row), so unlike most reads here there is no
// ErrNotFound case to handle.
func (r *Repository) GetSettings(ctx context.Context) (*models.AppSettings, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+settingsColumns+` FROM app_settings WHERE id = true`)
	var s models.AppSettings
	if err := row.Scan(&s.MmkPerUsd, &s.PaymentPhone, &s.PaymentWallets, &s.UpdatedAt); err != nil {
		return nil, fmt.Errorf("scan settings: %w", err)
	}
	return &s, nil
}

// UpdateSettings overwrites every field of the singleton row.
func (r *Repository) UpdateSettings(ctx context.Context, mmkPerUsd float64, paymentPhone string, paymentWallets []string) (*models.AppSettings, error) {
	row := r.pool.QueryRow(ctx, `
		UPDATE app_settings
		SET mmk_per_usd = $1, payment_phone = $2, payment_wallets = $3, updated_at = now()
		WHERE id = true
		RETURNING `+settingsColumns, mmkPerUsd, paymentPhone, paymentWallets)
	var s models.AppSettings
	if err := row.Scan(&s.MmkPerUsd, &s.PaymentPhone, &s.PaymentWallets, &s.UpdatedAt); err != nil {
		return nil, fmt.Errorf("scan updated settings: %w", err)
	}
	return &s, nil
}
