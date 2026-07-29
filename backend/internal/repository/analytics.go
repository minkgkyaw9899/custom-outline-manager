package repository

import (
	"context"
	"fmt"
	"time"

	"outline-manager/internal/models"
)

// RetentionMetrics computes the renewal-lapse rate, holder churn, new-holder
// trend, and average active-holder tenure over the trailing `days`. See
// models.RetentionMetrics for why there is no currency-denominated LTV here.
func (r *Repository) RetentionMetrics(ctx context.Context, days int) (*models.RetentionMetrics, error) {
	since := time.Now().Add(-time.Duration(days) * 24 * time.Hour)
	m := &models.RetentionMetrics{WindowDays: days}

	// Renewed: distinct keys with a renewal logged in the window, regardless
	// of current status. Lapsed: keys currently expired whose end_date still
	// falls in the window — if they had since been renewed, end_date would
	// have moved into the future and status would no longer be "expired".
	if err := r.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT key_id) FROM renewal_logs WHERE created_at >= $1
	`, since).Scan(&m.RenewedCount); err != nil {
		return nil, fmt.Errorf("count renewed keys: %w", err)
	}
	if err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM keys WHERE status = 'expired' AND end_date >= $1
	`, since).Scan(&m.LapsedCount); err != nil {
		return nil, fmt.Errorf("count lapsed keys: %w", err)
	}
	if total := m.RenewedCount + m.LapsedCount; total > 0 {
		m.RenewalLapseRatePct = float64(m.LapsedCount) / float64(total) * 100
	}

	// Considered: holders with at least one key that was active sometime in
	// the window (no expiry, or expiry falling inside it). Churned: of those,
	// how many now have zero currently-active keys.
	if err := r.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT u.id)
		FROM users u
		JOIN keys k ON k.user_id = u.id
		WHERE k.end_date IS NULL OR k.end_date >= $1
	`, since).Scan(&m.ConsideredHolders); err != nil {
		return nil, fmt.Errorf("count considered holders: %w", err)
	}
	if err := r.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT u.id)
		FROM users u
		JOIN keys k ON k.user_id = u.id
		WHERE (k.end_date IS NULL OR k.end_date >= $1)
		  AND NOT EXISTS (
		      SELECT 1 FROM keys ak WHERE ak.user_id = u.id AND ak.status = 'active'
		  )
	`, since).Scan(&m.ChurnedHolders); err != nil {
		return nil, fmt.Errorf("count churned holders: %w", err)
	}
	if m.ConsideredHolders > 0 {
		m.HolderChurnRatePct = float64(m.ChurnedHolders) / float64(m.ConsideredHolders) * 100
	}

	rows, err := r.pool.Query(ctx, `
		SELECT date_trunc('day', created_at)::date AS day, COUNT(*)
		FROM users
		WHERE created_at >= $1
		GROUP BY 1
		ORDER BY 1
	`, since)
	if err != nil {
		return nil, fmt.Errorf("new holders trend: %w", err)
	}
	defer rows.Close()
	m.NewHoldersSeries = make([]models.DailyCount, 0)
	for rows.Next() {
		var day time.Time
		var count int
		if err := rows.Scan(&day, &count); err != nil {
			return nil, fmt.Errorf("scan new holders row: %w", err)
		}
		m.NewHoldersSeries = append(m.NewHoldersSeries, models.DailyCount{
			Date:  day.Format("2006-01-02"),
			Count: count,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("new holders trend: %w", err)
	}

	var avgTenureDays *float64
	if err := r.pool.QueryRow(ctx, `
		SELECT AVG(EXTRACT(EPOCH FROM (now() - u.created_at)) / 86400)
		FROM users u
		WHERE EXISTS (SELECT 1 FROM keys k WHERE k.user_id = u.id AND k.status = 'active')
	`).Scan(&avgTenureDays); err != nil {
		return nil, fmt.Errorf("avg active holder tenure: %w", err)
	}
	if avgTenureDays != nil {
		m.AvgActiveHolderTenureDays = *avgTenureDays
	}

	return m, nil
}
