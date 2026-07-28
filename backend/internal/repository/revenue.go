package repository

import (
	"context"
	"fmt"
	"time"

	"outline-manager/internal/models"
)

// SnapshotRevenue records one row per server with its current revenue, cost
// and key-pricing figures — the same computation ListServers makes for the
// live dashboard, just also persisted so a history can build up over time.
// Called once per cron tick, covering every server in a single statement.
func (r *Repository) SnapshotRevenue(ctx context.Context) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO revenue_snapshots (server_id, revenue_mmk, cost_usd_per_month, active_keys, unpriced_active_keys)
		SELECT s.id,
		       COALESCE(SUM(COALESCE(k.price_mmk, s.default_price_mmk, 0)) FILTER (WHERE k.status = 'active'), 0),
		       s.cost_usd_per_month,
		       COUNT(k.id) FILTER (WHERE k.status = 'active'),
		       COUNT(k.id) FILTER (WHERE k.status = 'active' AND k.price_mmk IS NULL AND s.default_price_mmk IS NULL)
		FROM servers s
		LEFT JOIN keys k ON k.server_id = s.id
		WHERE s.deleted_at IS NULL
		GROUP BY s.id
	`)
	if err != nil {
		return fmt.Errorf("snapshot revenue: %w", err)
	}
	return nil
}

// DailyRevenueAllServers returns one point per calendar day per server over
// the last `days` days, keyed by server id — the latest snapshot recorded
// that day, not a sum: revenue is a level (what active keys are worth right
// now), and summing repeated readings of the same figure would inflate it
// rather than total anything real.
func (r *Repository) DailyRevenueAllServers(ctx context.Context, days int) (map[string][]models.RevenuePoint, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT ON (server_id, date_trunc('day', recorded_at))
		       server_id, date_trunc('day', recorded_at) AS day,
		       revenue_mmk, cost_usd_per_month, active_keys, unpriced_active_keys
		FROM revenue_snapshots
		WHERE recorded_at >= now() - make_interval(days => $1)
		ORDER BY server_id, date_trunc('day', recorded_at), recorded_at DESC
	`, days)
	if err != nil {
		return nil, fmt.Errorf("daily revenue: %w", err)
	}
	defer rows.Close()

	out := make(map[string][]models.RevenuePoint)
	for rows.Next() {
		var serverID string
		var day time.Time
		var p models.RevenuePoint
		if err := rows.Scan(&serverID, &day, &p.RevenueMmk, &p.CostUsdPerMonth, &p.ActiveKeys, &p.UnpricedActiveKeys); err != nil {
			return nil, fmt.Errorf("scan daily revenue: %w", err)
		}
		p.Date = day.Format("2006-01-02")
		out[serverID] = append(out[serverID], p)
	}
	return out, rows.Err()
}
