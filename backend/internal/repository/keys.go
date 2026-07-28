package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"outline-manager/internal/authn"
	"outline-manager/internal/models"
)

const keyColumns = `k.id, k.server_id, k.outline_key_id, k.name, k.access_url, k.port, k.method,
	k.used_bytes, k.custom_limit_bytes, k.end_date, k.enabled, k.status, k.created_at, k.updated_at,
	k.password, k.dynamic_token, k.user_id, k.price_mmk, k.auto_renew`

// maxDynamicTokenAttempts bounds the retry loop for a colliding dynamic
// token. Collision on 128 bits of random entropy is astronomically unlikely;
// this only guards against a pathological RNG failure, mirroring
// maxSlugAttempts in shares.go.
const maxDynamicTokenAttempts = 5

// UpsertKeyFromOutline adopts a key discovered on the Outline server. Only the
// Outline-owned fields are refreshed; local policy (custom_limit_bytes,
// end_date) and usage are never overwritten here. dynamic_token is generated
// once on first insert and never touched again, so a key's dynamic access
// link stays stable across every later sync.
func (r *Repository) UpsertKeyFromOutline(ctx context.Context, serverID, outlineKeyID, name, accessURL string, port int, method, password string) (*models.Key, error) {
	var lastErr error
	for i := 0; i < maxDynamicTokenAttempts; i++ {
		token, err := authn.GenerateSlug()
		if err != nil {
			return nil, fmt.Errorf("generate dynamic token: %w", err)
		}
		row := r.pool.QueryRow(ctx, `
			INSERT INTO keys AS k (server_id, outline_key_id, name, access_url, port, method, password, dynamic_token)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (server_id, outline_key_id) DO UPDATE SET
				name = EXCLUDED.name,
				access_url = EXCLUDED.access_url,
				port = EXCLUDED.port,
				method = EXCLUDED.method,
				password = EXCLUDED.password,
				updated_at = now()
			RETURNING `+keyColumns, serverID, outlineKeyID, name, accessURL, port, method, password, token)
		key, err := scanKey(row)
		if err == nil {
			return key, nil
		}
		if isUniqueViolation(err) {
			// Either the dynamic token collided (retry with a new one) or this
			// is a genuine (server_id, outline_key_id) conflict that the
			// ON CONFLICT clause should have absorbed instead of erroring — in
			// which case retrying is harmless, it will just hit the same path
			// again with a fresh token.
			lastErr = err
			continue
		}
		return nil, err
	}
	return nil, fmt.Errorf("upsert key from outline: %w", lastErr)
}

func (r *Repository) CreateKey(ctx context.Context, serverID, outlineKeyID, name, accessURL string, port int, method, password string, customLimitBytes *int64, endDate *time.Time, userID *string, priceMmk *int64) (*models.Key, error) {
	var lastErr error
	for i := 0; i < maxDynamicTokenAttempts; i++ {
		token, err := authn.GenerateSlug()
		if err != nil {
			return nil, fmt.Errorf("generate dynamic token: %w", err)
		}
		row := r.pool.QueryRow(ctx, `
			INSERT INTO keys AS k (server_id, outline_key_id, name, access_url, port, method, password, dynamic_token, custom_limit_bytes, end_date, user_id, price_mmk)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			RETURNING `+keyColumns, serverID, outlineKeyID, name, accessURL, port, method, password, token, customLimitBytes, endDate, userID, priceMmk)
		key, err := scanKey(row)
		if err == nil {
			return key, nil
		}
		if isUniqueViolation(err) {
			lastErr = err
			continue
		}
		return nil, err
	}
	return nil, fmt.Errorf("create key: %w", lastErr)
}

func (r *Repository) GetKey(ctx context.Context, id string) (*models.Key, error) {
	if !isUUID(id) {
		return nil, ErrNotFound
	}
	row := r.pool.QueryRow(ctx, `SELECT `+keyColumns+` FROM keys k WHERE k.id = $1`, id)
	return scanKey(row)
}

// GetKeyByDynamicToken looks up a key by its ssconf:// dynamic access token,
// for the public GET /api/v1/dkey/:token endpoint.
func (r *Repository) GetKeyByDynamicToken(ctx context.Context, token string) (*models.Key, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+keyColumns+` FROM keys k WHERE k.dynamic_token = $1`, token)
	return scanKey(row)
}

func (r *Repository) ListKeysByServer(ctx context.Context, serverID string) ([]models.Key, error) {
	if !isUUID(serverID) {
		return nil, ErrNotFound
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+keyColumns+`, COALESCE(u.name, '')
		FROM keys k LEFT JOIN users u ON u.id = k.user_id
		WHERE k.server_id = $1
		ORDER BY k.created_at ASC
	`, serverID)
	if err != nil {
		return nil, fmt.Errorf("list keys by server: %w", err)
	}
	defer rows.Close()
	return collectKeys(rows, keyJoins{userName: true})
}

// ListAllKeys returns every key across every server, with the server and
// holder names joined in for the "all keys" table.
func (r *Repository) ListAllKeys(ctx context.Context) ([]models.Key, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+keyColumns+`, s.name, COALESCE(u.name, '')
		FROM keys k
		JOIN servers s ON s.id = k.server_id
		LEFT JOIN users u ON u.id = k.user_id
		ORDER BY k.created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list all keys: %w", err)
	}
	defer rows.Close()
	return collectKeys(rows, keyJoins{serverName: true, userName: true})
}

// ListKeysByUser returns one user's keys, newest first, with the server name
// joined in — a user's keys are shown grouped by which server they live on.
func (r *Repository) ListKeysByUser(ctx context.Context, userID string) ([]models.Key, error) {
	if !isUUID(userID) {
		return nil, ErrNotFound
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+keyColumns+`, s.name
		FROM keys k JOIN servers s ON s.id = k.server_id
		WHERE k.user_id = $1
		ORDER BY k.created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list keys by user: %w", err)
	}
	defer rows.Close()
	return collectKeys(rows, keyJoins{serverName: true})
}

// ListUnassignedKeys returns keys not yet linked to any user, which is what
// the "link an existing key" picker offers. Keys adopted from an Outline
// server all start here.
func (r *Repository) ListUnassignedKeys(ctx context.Context) ([]models.Key, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+keyColumns+`, s.name
		FROM keys k JOIN servers s ON s.id = k.server_id
		WHERE k.user_id IS NULL
		ORDER BY s.name ASC, k.created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list unassigned keys: %w", err)
	}
	defer rows.Close()
	return collectKeys(rows, keyJoins{serverName: true})
}

// ListKeysNeedingLowUsageAlert returns active keys that are either close to
// their data limit or close to expiry, and haven't already been alerted
// within the last debounceHours — the two independent Telegram-alert trigger
// conditions, feeding the cron's low-usage/near-expiry check.
func (r *Repository) ListKeysNeedingLowUsageAlert(ctx context.Context, remainingBytesThreshold int64, daysLeftThreshold, debounceHours int) ([]models.Key, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+keyColumns+`, s.name, COALESCE(u.name, '')
		FROM keys k
		JOIN servers s ON s.id = k.server_id
		LEFT JOIN users u ON u.id = k.user_id
		WHERE k.status = 'active'
		  AND (
		    (k.custom_limit_bytes IS NOT NULL AND (k.custom_limit_bytes - k.used_bytes) < $1)
		    OR
		    (k.end_date IS NOT NULL AND k.end_date < now() + make_interval(days => $2))
		  )
		  AND (k.low_usage_alert_sent_at IS NULL OR k.low_usage_alert_sent_at < now() - make_interval(hours => $3))
		ORDER BY k.created_at ASC
	`, remainingBytesThreshold, daysLeftThreshold, debounceHours)
	if err != nil {
		return nil, fmt.Errorf("list keys needing low usage alert: %w", err)
	}
	defer rows.Close()
	return collectKeys(rows, keyJoins{serverName: true, userName: true})
}

// SetKeyLowUsageAlertSentAt records when a Telegram alert was sent for this
// key, so ListKeysNeedingLowUsageAlert's debounce window can skip it on
// subsequent cron ticks until the window passes.
func (r *Repository) SetKeyLowUsageAlertSentAt(ctx context.Context, id string, t time.Time) error {
	_, err := r.pool.Exec(ctx, `UPDATE keys SET low_usage_alert_sent_at = $2 WHERE id = $1`, id, t)
	return err
}

// SetKeyUser links a key to a user, or unlinks it when userID is nil.
//
// Unlinking also drops the key's nomination as anyone's primary, so a user's
// dynamic link can never resolve to a key they no longer hold. The FK's
// ON DELETE SET NULL covers the delete case; this covers the unlink case,
// which leaves the key row very much alive.
func (r *Repository) SetKeyUser(ctx context.Context, id string, userID *string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	tag, err := r.pool.Exec(ctx, `UPDATE keys SET user_id = $2, updated_at = now() WHERE id = $1`, id, userID)
	if err != nil {
		return fmt.Errorf("set key user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := r.pool.Exec(ctx, `
		UPDATE users SET primary_key_id = NULL, updated_at = now()
		WHERE primary_key_id = $1 AND ($2::uuid IS NULL OR id <> $2)
	`, id, userID); err != nil {
		return fmt.Errorf("clear stale primary key: %w", err)
	}
	return nil
}

// ApplyDefaultLimitToUnlimitedKeys puts every quota-less key on a server onto
// limitBytes, returning the ids it changed so the caller can reconcile just
// those against Outline. Keys that already carry a ceiling are left alone —
// the server-wide default is a floor for unmanaged keys, not a reset button
// that would wipe out an individually-negotiated allowance.
func (r *Repository) ApplyDefaultLimitToUnlimitedKeys(ctx context.Context, serverID string, limitBytes int64) ([]string, error) {
	if !isUUID(serverID) {
		return nil, ErrNotFound
	}
	rows, err := r.pool.Query(ctx, `
		UPDATE keys SET custom_limit_bytes = $2, updated_at = now()
		WHERE server_id = $1 AND custom_limit_bytes IS NULL
		RETURNING id
	`, serverID, limitBytes)
	if err != nil {
		return nil, fmt.Errorf("apply default limit: %w", err)
	}
	defer rows.Close()

	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan updated key id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *Repository) UpdateKeyUsage(ctx context.Context, id string, usedBytes int64) error {
	_, err := r.pool.Exec(ctx, `UPDATE keys SET used_bytes = $2, updated_at = now() WHERE id = $1`, id, usedBytes)
	return err
}

func (r *Repository) SetKeyEnabledStatus(ctx context.Context, id string, enabled bool, status models.KeyStatus) error {
	_, err := r.pool.Exec(ctx, `UPDATE keys SET enabled = $2, status = $3, updated_at = now() WHERE id = $1`, id, enabled, status)
	return err
}

// SetKeyName records a rename that has already been accepted by Outline, so
// the next sync (which copies Outline's name over ours) agrees with us.
func (r *Repository) SetKeyName(ctx context.Context, id, name string) error {
	_, err := r.pool.Exec(ctx, `UPDATE keys SET name = $2, updated_at = now() WHERE id = $1`, id, name)
	return err
}

// SetKeyLimitAndEndDate is used by the renew/top-up endpoint.
func (r *Repository) SetKeyLimitAndEndDate(ctx context.Context, id string, customLimitBytes *int64, endDate *time.Time) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE keys SET custom_limit_bytes = $2, end_date = $3, updated_at = now() WHERE id = $1
	`, id, customLimitBytes, endDate)
	return err
}

// SetKeyPrice writes this key's own price in MMK, overriding its server's
// default for revenue purposes. Nil clears the override back to "no price
// set" (distinct from 0, which is an explicit "this key is free") — assigned
// directly rather than COALESCEd, so a caller can go either way.
func (r *Repository) SetKeyPrice(ctx context.Context, id string, priceMmk *int64) error {
	_, err := r.pool.Exec(ctx, `UPDATE keys SET price_mmk = $2, updated_at = now() WHERE id = $1`, id, priceMmk)
	return err
}

func (r *Repository) SetKeyAutoRenew(ctx context.Context, id string, autoRenew bool) error {
	_, err := r.pool.Exec(ctx, `UPDATE keys SET auto_renew = $2, updated_at = now() WHERE id = $1`, id, autoRenew)
	return err
}

// ListKeysWithAutoRenew returns every opted-in key, across every server, for
// the cron sweep to check against the low-usage/near-expiry condition.
func (r *Repository) ListKeysWithAutoRenew(ctx context.Context) ([]models.Key, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+keyColumns+`, s.name, COALESCE(u.name, '')
		FROM keys k
		JOIN servers s ON s.id = k.server_id
		LEFT JOIN users u ON u.id = k.user_id
		WHERE k.auto_renew = true
	`)
	if err != nil {
		return nil, fmt.Errorf("list keys with auto renew: %w", err)
	}
	defer rows.Close()
	return collectKeys(rows, keyJoins{serverName: true, userName: true})
}

func (r *Repository) DeleteKey(ctx context.Context, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM keys WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete key: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DashboardStats aggregates the headline numbers for GET /api/stats.
func (r *Repository) DashboardStats(ctx context.Context) (*models.DashboardStats, error) {
	var s models.DashboardStats
	err := r.pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM servers),
			(SELECT COUNT(*) FROM keys),
			(SELECT COUNT(*) FROM keys WHERE status = 'active'),
			(SELECT COUNT(*) FROM keys WHERE status = 'expired'),
			(SELECT COUNT(*) FROM keys WHERE status = 'limit_exceeded'),
			(SELECT COALESCE(SUM(used_bytes), 0) FROM keys)
	`).Scan(&s.TotalServers, &s.TotalKeys, &s.ActiveKeys, &s.ExpiredKeys, &s.LimitExceededKeys, &s.CombinedUsedBytes)
	if err != nil {
		return nil, fmt.Errorf("dashboard stats: %w", err)
	}
	return &s, nil
}

func scanKey(row pgx.Row) (*models.Key, error) {
	var k models.Key
	if err := row.Scan(&k.ID, &k.ServerID, &k.OutlineKeyID, &k.Name, &k.AccessURL, &k.Port, &k.Method,
		&k.UsedBytes, &k.CustomLimitBytes, &k.EndDate, &k.Enabled, &k.Status, &k.CreatedAt, &k.UpdatedAt,
		&k.Password, &k.DynamicToken, &k.UserID, &k.PriceMmk, &k.AutoRenew); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan key: %w", err)
	}
	return &k, nil
}

// keyJoins names the optional trailing columns a query selected alongside
// keyColumns, so collectKeys knows how many extra scan targets to expect.
type keyJoins struct {
	serverName bool
	userName   bool
}

// collectKeys drains rows selected with keyColumns plus whichever joined
// display names the caller asked for, in the order declared here.
func collectKeys(rows pgx.Rows, joins keyJoins) ([]models.Key, error) {
	out := make([]models.Key, 0)
	for rows.Next() {
		var k models.Key
		// A key with no user scans back as SQL NULL, which cannot go straight
		// into a string field.
		var userName *string
		dest := []any{&k.ID, &k.ServerID, &k.OutlineKeyID, &k.Name, &k.AccessURL, &k.Port, &k.Method,
			&k.UsedBytes, &k.CustomLimitBytes, &k.EndDate, &k.Enabled, &k.Status, &k.CreatedAt, &k.UpdatedAt,
			&k.Password, &k.DynamicToken, &k.UserID, &k.PriceMmk, &k.AutoRenew}
		if joins.serverName {
			dest = append(dest, &k.ServerName)
		}
		if joins.userName {
			dest = append(dest, &userName)
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, fmt.Errorf("scan key: %w", err)
		}
		if userName != nil {
			k.UserName = *userName
		}
		out = append(out, k)
	}
	return out, rows.Err()
}
