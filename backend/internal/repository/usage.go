package repository

import (
	"context"
	"fmt"
	"time"

	"outline-manager/internal/models"
)

// InsertUsageSnapshot appends a cumulative-usage reading. A nil keyID records
// the server-wide total.
func (r *Repository) InsertUsageSnapshot(ctx context.Context, serverID string, keyID *string, bytesTotal int64) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO usage_snapshots (server_id, key_id, bytes_total) VALUES ($1, $2, $3)
	`, serverID, keyID, bytesTotal)
	return err
}

// DailyUsageAllServers returns per-day measured traffic for every server over
// the last `days` days, keyed by server id.
//
// Outline exposes no time series, so this is derived from the cumulative
// snapshots the cron writes. Each day takes the highest server-wide cumulative
// reading and subtracts the previous day's, which means:
//
//   - the earliest day in the window has no predecessor and so contributes no
//     measured delta (it is skipped, not reported as zero);
//   - deltas are clamped at zero, because Outline's counters reset when a key
//     is recreated or the server restarts, which would otherwise show up as
//     large negative traffic.
//
// Done as a single query for all servers rather than per server, so rendering
// N cards costs one round trip instead of N.
func (r *Repository) DailyUsageAllServers(ctx context.Context, days int) (map[string][]models.DailyUsage, error) {
	rows, err := r.pool.Query(ctx, `
		WITH daily AS (
			SELECT server_id,
			       date_trunc('day', recorded_at) AS day,
			       MAX(bytes_total) AS total
			FROM usage_snapshots
			WHERE key_id IS NULL
			  AND recorded_at >= now() - make_interval(days => $1)
			GROUP BY server_id, date_trunc('day', recorded_at)
		),
		delta AS (
			SELECT server_id, day,
			       total - LAG(total) OVER (PARTITION BY server_id ORDER BY day) AS bytes
			FROM daily
		)
		SELECT server_id, day, GREATEST(bytes, 0)
		FROM delta
		WHERE bytes IS NOT NULL
		ORDER BY server_id, day
	`, days)
	if err != nil {
		return nil, fmt.Errorf("daily usage: %w", err)
	}
	defer rows.Close()

	out := make(map[string][]models.DailyUsage)
	for rows.Next() {
		var serverID string
		var day time.Time
		var bytes int64
		if err := rows.Scan(&serverID, &day, &bytes); err != nil {
			return nil, fmt.Errorf("scan daily usage: %w", err)
		}
		out[serverID] = append(out[serverID], models.DailyUsage{
			Date:  day.Format("2006-01-02"),
			Bytes: bytes,
		})
	}
	return out, rows.Err()
}

// DailyUsageByKey returns per-day measured traffic for one key over the last
// `days` days.
//
// Same derivation as DailyUsageAllServers, against the per-key snapshot rows
// instead of the server-wide ones: highest cumulative reading per day, minus
// the previous day's, clamped at zero because Outline's counter restarts when a
// key is recreated. The delta is computed over the key's whole history (not
// just the requested window) so its very first calendar day is seeded from a
// zero baseline instead of being dropped for want of a predecessor — a brand
// new key's creation day is real usage, not a gap. Only the window filter
// (applied after the delta, not before) trims the result down to `days`.
func (r *Repository) DailyUsageByKey(ctx context.Context, keyID string, days int) ([]models.DailyUsage, error) {
	if !isUUID(keyID) {
		return nil, ErrNotFound
	}
	rows, err := r.pool.Query(ctx, `
		WITH daily AS (
			SELECT date_trunc('day', recorded_at) AS day,
			       MAX(bytes_total) AS total
			FROM usage_snapshots
			WHERE key_id = $1
			GROUP BY date_trunc('day', recorded_at)
		),
		delta AS (
			SELECT day, total - LAG(total, 1, 0) OVER (ORDER BY day) AS bytes
			FROM daily
		)
		SELECT day, GREATEST(bytes, 0)
		FROM delta
		WHERE day >= now() - make_interval(days => $2)
		ORDER BY day
	`, keyID, days)
	if err != nil {
		return nil, fmt.Errorf("daily usage by key: %w", err)
	}
	defer rows.Close()

	out := make([]models.DailyUsage, 0)
	for rows.Next() {
		var day time.Time
		var bytes int64
		if err := rows.Scan(&day, &bytes); err != nil {
			return nil, fmt.Errorf("scan daily usage by key: %w", err)
		}
		out = append(out, models.DailyUsage{Date: day.Format("2006-01-02"), Bytes: bytes})
	}
	return out, rows.Err()
}

// HourlyUsageByKey returns per-hour measured traffic for one key over the
// last `hours` hours. Used in place of DailyUsageByKey for a key less than a
// day old, where a whole calendar-day bucket would otherwise show nothing
// useful until its first day rolls over.
//
// Same derivation as DailyUsageByKey — highest cumulative reading per bucket
// minus the previous bucket's, clamped at zero, seeded from a zero baseline
// on the key's very first bucket — against hour buckets instead of day ones.
func (r *Repository) HourlyUsageByKey(ctx context.Context, keyID string, hours int) ([]models.DailyUsage, error) {
	if !isUUID(keyID) {
		return nil, ErrNotFound
	}
	rows, err := r.pool.Query(ctx, `
		WITH hourly AS (
			SELECT date_trunc('hour', recorded_at) AS bucket,
			       MAX(bytes_total) AS total
			FROM usage_snapshots
			WHERE key_id = $1
			GROUP BY date_trunc('hour', recorded_at)
		),
		delta AS (
			SELECT bucket, total - LAG(total, 1, 0) OVER (ORDER BY bucket) AS bytes
			FROM hourly
		)
		SELECT bucket, GREATEST(bytes, 0)
		FROM delta
		WHERE bucket >= now() - make_interval(hours => $2)
		ORDER BY bucket
	`, keyID, hours)
	if err != nil {
		return nil, fmt.Errorf("hourly usage by key: %w", err)
	}
	defer rows.Close()

	out := make([]models.DailyUsage, 0)
	for rows.Next() {
		var bucket time.Time
		var bytes int64
		if err := rows.Scan(&bucket, &bytes); err != nil {
			return nil, fmt.Errorf("scan hourly usage by key: %w", err)
		}
		out = append(out, models.DailyUsage{Date: bucket.Format(time.RFC3339), Bytes: bytes})
	}
	return out, rows.Err()
}

// DailyUsageByServer returns per-day measured traffic for one server over the
// last `days` days.
//
// Same derivation as DailyUsageByKey, against the server-wide (key_id IS NULL)
// snapshot rows instead of the all-servers query: highest cumulative reading
// per day, minus the previous day's, clamped at zero. The earliest day in the
// window has no predecessor and so contributes nothing, which is why a
// newly-added server needs two days of history before its chart has a single
// point.
func (r *Repository) DailyUsageByServer(ctx context.Context, serverID string, days int) ([]models.DailyUsage, error) {
	if !isUUID(serverID) {
		return nil, ErrNotFound
	}
	rows, err := r.pool.Query(ctx, `
		WITH daily AS (
			SELECT date_trunc('day', recorded_at) AS day,
			       MAX(bytes_total) AS total
			FROM usage_snapshots
			WHERE server_id = $1
			  AND key_id IS NULL
			  AND recorded_at >= now() - make_interval(days => $2)
			GROUP BY date_trunc('day', recorded_at)
		),
		delta AS (
			SELECT day, total - LAG(total) OVER (ORDER BY day) AS bytes
			FROM daily
		)
		SELECT day, GREATEST(bytes, 0)
		FROM delta
		WHERE bytes IS NOT NULL
		ORDER BY day
	`, serverID, days)
	if err != nil {
		return nil, fmt.Errorf("daily usage by server: %w", err)
	}
	defer rows.Close()

	out := make([]models.DailyUsage, 0)
	for rows.Next() {
		var day time.Time
		var bytes int64
		if err := rows.Scan(&day, &bytes); err != nil {
			return nil, fmt.Errorf("scan daily usage by server: %w", err)
		}
		out = append(out, models.DailyUsage{Date: day.Format("2006-01-02"), Bytes: bytes})
	}
	return out, rows.Err()
}

// ServerUsageInRange estimates bandwidth consumed by a server between from and
// to, by summing, per key, the most recent cumulative snapshot at/before `to`
// minus the most recent cumulative snapshot at/before `from` (or the earliest
// available snapshot if the key has none before `from`).
//
// Outline's transfer counters reset when a key is recreated or the server
// restarts, so per-key deltas are clamped at zero to keep a reset from
// subtracting from the total.
func (r *Repository) ServerUsageInRange(ctx context.Context, serverID string, from, to time.Time) (int64, error) {
	if !isUUID(serverID) {
		return 0, ErrNotFound
	}
	var total int64
	err := r.pool.QueryRow(ctx, `
		WITH per_key AS (SELECT DISTINCT key_id FROM usage_snapshots WHERE server_id = $1 AND key_id IS NOT NULL),
		start_val AS (
			SELECT pk.key_id,
			       COALESCE(
			         (SELECT bytes_total FROM usage_snapshots u WHERE u.key_id = pk.key_id AND u.recorded_at <= $2 ORDER BY u.recorded_at DESC LIMIT 1),
			         (SELECT bytes_total FROM usage_snapshots u WHERE u.key_id = pk.key_id ORDER BY u.recorded_at ASC LIMIT 1),
			         0
			       ) AS bytes_total
			FROM per_key pk
		),
		end_val AS (
			SELECT pk.key_id,
			       COALESCE(
			         (SELECT bytes_total FROM usage_snapshots u WHERE u.key_id = pk.key_id AND u.recorded_at <= $3 ORDER BY u.recorded_at DESC LIMIT 1),
			         0
			       ) AS bytes_total
			FROM per_key pk
		)
		SELECT COALESCE(SUM(GREATEST(e.bytes_total - s.bytes_total, 0)), 0)
		FROM end_val e JOIN start_val s ON s.key_id = e.key_id
	`, serverID, from, to).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("server usage in range: %w", err)
	}
	return total, nil
}
