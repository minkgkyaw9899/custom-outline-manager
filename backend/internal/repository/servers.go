package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"outline-manager/internal/models"
)

const serverColumns = `id, name, api_url, cert_sha256, cost_usd_per_month, last_synced_at, last_sync_error, created_at, updated_at, max_keys, default_limit_bytes, default_price_mmk, bandwidth_limit_bytes, bandwidth_disabled_at, bandwidth_reenabled_at`

// ServerLookup is the minimal existing-server info GetServerByAPIURL returns,
// so createServer can decide whether an api_url it was just handed belongs to
// no server (proceed normally), an active one (reject as a duplicate), or an
// archived one (revive it — see ReviveServer).
type ServerLookup struct {
	ID         string
	CertSHA256 string
	Deleted    bool
}

func (r *Repository) CreateServer(ctx context.Context, name, apiURL, certSHA256 string, costUSDPerMonth *float64, maxKeys *int, defaultLimitBytes *int64, defaultPriceMmk *int64, bandwidthLimitBytes *int64) (*models.Server, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO servers (name, api_url, cert_sha256, cost_usd_per_month, max_keys, default_limit_bytes, default_price_mmk, bandwidth_limit_bytes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+serverColumns, name, apiURL, certSHA256, costUSDPerMonth, maxKeys, defaultLimitBytes, defaultPriceMmk, bandwidthLimitBytes)
	return scanServer(row)
}

// UpdateServerDetails writes the admin-editable metadata. Each argument is
// nil-to-skip, so the handler can send only what the dialog actually changed
// and a partial update never blanks a field it wasn't asked about. The one
// thing it cannot express is clearing cost/max-keys back to NULL — see
// ClearServerLimit and the handler's explicit-null handling.
// GetServerByAPIURL looks up any server at this exact management-key URL,
// active or archived (soft-deleted) — createServer needs to see archived
// matches too, to offer a revive instead of erroring on the now-freed URL.
func (r *Repository) GetServerByAPIURL(ctx context.Context, apiURL string) (*ServerLookup, error) {
	var l ServerLookup
	err := r.pool.QueryRow(ctx, `
		SELECT id, cert_sha256, deleted_at IS NOT NULL FROM servers WHERE api_url = $1
	`, apiURL).Scan(&l.ID, &l.CertSHA256, &l.Deleted)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get server by api url: %w", err)
	}
	return &l, nil
}

// ReviveServer un-archives a previously soft-deleted server, adopting the
// freshly submitted name/apiUrl/cert/cost/limits exactly as a normal
// CreateServer would — but reusing the existing row (and its id) so every
// key, renewal log and usage snapshot still hanging off that server_id comes
// back with it. last_sync_error is cleared so a stale failure from before
// the server was removed doesn't linger on the revived one.
func (r *Repository) ReviveServer(ctx context.Context, id, name, apiURL, certSHA256 string, costUSDPerMonth *float64, maxKeys *int, defaultLimitBytes *int64, defaultPriceMmk *int64, bandwidthLimitBytes *int64) (*models.Server, error) {
	row := r.pool.QueryRow(ctx, `
		UPDATE servers SET
			deleted_at = NULL,
			name = $2,
			api_url = $3,
			cert_sha256 = $4,
			cost_usd_per_month = $5,
			max_keys = $6,
			default_limit_bytes = $7,
			default_price_mmk = $8,
			bandwidth_limit_bytes = $9,
			last_sync_error = NULL,
			updated_at = now()
		WHERE id = $1
		RETURNING `+serverColumns, id, name, apiURL, certSHA256, costUSDPerMonth, maxKeys, defaultLimitBytes, defaultPriceMmk, bandwidthLimitBytes)
	return scanServer(row)
}

func (r *Repository) UpdateServerDetails(ctx context.Context, id string, name *string, costUSDPerMonth *float64, maxKeys *int, defaultPriceMmk *int64, bandwidthLimitBytes *int64) (*models.Server, error) {
	if !isUUID(id) {
		return nil, ErrNotFound
	}
	row := r.pool.QueryRow(ctx, `
		UPDATE servers SET
			name = COALESCE($2, name),
			cost_usd_per_month = COALESCE($3, cost_usd_per_month),
			max_keys = COALESCE($4, max_keys),
			default_price_mmk = COALESCE($5, default_price_mmk),
			bandwidth_limit_bytes = COALESCE($6, bandwidth_limit_bytes),
			updated_at = now()
		WHERE id = $1
		RETURNING `+serverColumns, id, name, costUSDPerMonth, maxKeys, defaultPriceMmk, bandwidthLimitBytes)
	return scanServer(row)
}

// ClearServerBandwidthLimit removes the monthly bandwidth cap, the one edit
// UpdateServerDetails cannot express (COALESCE treats nil as "leave alone").
func (r *Repository) ClearServerBandwidthLimit(ctx context.Context, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	_, err := r.pool.Exec(ctx, `UPDATE servers SET bandwidth_limit_bytes = NULL, updated_at = now() WHERE id = $1`, id)
	return err
}

// SetServerBandwidthDisabled trips the bandwidth kill switch — every key on
// the server is forced to a 0-byte Outline limit on the next reconcile.
func (r *Repository) SetServerBandwidthDisabled(ctx context.Context, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	_, err := r.pool.Exec(ctx, `UPDATE servers SET bandwidth_disabled_at = now(), updated_at = now() WHERE id = $1`, id)
	return err
}

// ClearServerBandwidthDisabled is the manual admin re-enable: clears the kill
// switch and records when, so the cron doesn't immediately re-trip the same
// server in the same calendar month it was just overridden in.
func (r *Repository) ClearServerBandwidthDisabled(ctx context.Context, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE servers SET bandwidth_disabled_at = NULL, bandwidth_reenabled_at = now(), updated_at = now()
		WHERE id = $1
	`, id)
	return err
}

// ClearServerMaxKeys removes the key ceiling, the one edit UpdateServerDetails
// cannot express (COALESCE treats nil as "leave alone", not "set to NULL").
func (r *Repository) ClearServerMaxKeys(ctx context.Context, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	_, err := r.pool.Exec(ctx, `UPDATE servers SET max_keys = NULL, updated_at = now() WHERE id = $1`, id)
	return err
}

// ClearServerDefaultPrice removes the server's default per-key price, the one
// edit UpdateServerDetails cannot express (COALESCE treats nil as "leave
// alone", not "set to NULL") — same reasoning as ClearServerMaxKeys.
func (r *Repository) ClearServerDefaultPrice(ctx context.Context, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	_, err := r.pool.Exec(ctx, `UPDATE servers SET default_price_mmk = NULL, updated_at = now() WHERE id = $1`, id)
	return err
}

// SetServerDefaultLimit records the server-wide default quota. A nil value
// clears it, so this deliberately assigns rather than COALESCEs.
func (r *Repository) SetServerDefaultLimit(ctx context.Context, id string, limitBytes *int64) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	tag, err := r.pool.Exec(ctx, `UPDATE servers SET default_limit_bytes = $2, updated_at = now() WHERE id = $1`, id, limitBytes)
	if err != nil {
		return fmt.Errorf("set server default limit: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CountKeysByServer backs the max_keys ceiling check on key creation.
func (r *Repository) CountKeysByServer(ctx context.Context, serverID string) (int, error) {
	if !isUUID(serverID) {
		return 0, ErrNotFound
	}
	var n int
	if err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM keys WHERE server_id = $1`, serverID).Scan(&n); err != nil {
		return 0, fmt.Errorf("count keys by server: %w", err)
	}
	return n, nil
}

// ListServers returns every server with rolled-up key counts and usage for the
// dashboard's server list.
func (r *Repository) ListServers(ctx context.Context) ([]models.ServerWithUsage, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT s.id, s.name, s.api_url, s.cert_sha256, s.cost_usd_per_month, s.last_synced_at, s.last_sync_error, s.created_at, s.updated_at,
		       s.max_keys, s.default_limit_bytes, s.default_price_mmk,
		       s.bandwidth_limit_bytes, s.bandwidth_disabled_at, s.bandwidth_reenabled_at,
		       COUNT(k.id) AS key_count,
		       COUNT(k.id) FILTER (WHERE k.status = 'active') AS active_keys,
		       COALESCE(SUM(k.used_bytes), 0) AS total_used_bytes,
		       COALESCE(SUM(COALESCE(k.price_mmk, s.default_price_mmk, 0)) FILTER (WHERE k.status = 'active'), 0) AS monthly_revenue_mmk,
		       COUNT(k.id) FILTER (WHERE k.status = 'active' AND k.price_mmk IS NULL AND s.default_price_mmk IS NULL) AS unpriced_active_keys
		FROM servers s
		LEFT JOIN keys k ON k.server_id = s.id
		WHERE s.deleted_at IS NULL
		GROUP BY s.id
		ORDER BY s.created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list servers: %w", err)
	}
	defer rows.Close()

	out := make([]models.ServerWithUsage, 0)
	for rows.Next() {
		var s models.ServerWithUsage
		if err := rows.Scan(&s.ID, &s.Name, &s.APIURL, &s.CertSHA256, &s.CostUSDPerMonth, &s.LastSyncedAt, &s.LastSyncError, &s.CreatedAt, &s.UpdatedAt,
			&s.MaxKeys, &s.DefaultLimitBytes, &s.DefaultPriceMmk,
			&s.BandwidthLimitBytes, &s.BandwidthDisabledAt, &s.BandwidthReenabledAt,
			&s.KeyCount, &s.ActiveKeys, &s.TotalUsedBytes,
			&s.MonthlyRevenueMmk, &s.UnpricedActiveKeys); err != nil {
			return nil, fmt.Errorf("scan server: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *Repository) GetServer(ctx context.Context, id string) (*models.Server, error) {
	if !isUUID(id) {
		return nil, ErrNotFound
	}
	row := r.pool.QueryRow(ctx, `SELECT `+serverColumns+` FROM servers WHERE id = $1 AND deleted_at IS NULL`, id)
	return scanServer(row)
}

// ListAllServers returns bare server rows, for the cron loop. Archived
// servers are excluded so a revive-eligible but not-yet-revived server isn't
// synced/enforced against in the background.
func (r *Repository) ListAllServers(ctx context.Context) ([]models.Server, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+serverColumns+` FROM servers WHERE deleted_at IS NULL ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list all servers: %w", err)
	}
	defer rows.Close()

	out := make([]models.Server, 0)
	for rows.Next() {
		var s models.Server
		if err := rows.Scan(&s.ID, &s.Name, &s.APIURL, &s.CertSHA256, &s.CostUSDPerMonth, &s.LastSyncedAt, &s.LastSyncError, &s.CreatedAt, &s.UpdatedAt,
			&s.MaxKeys, &s.DefaultLimitBytes, &s.DefaultPriceMmk,
			&s.BandwidthLimitBytes, &s.BandwidthDisabledAt, &s.BandwidthReenabledAt); err != nil {
			return nil, fmt.Errorf("scan server: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// DeleteServer archives a server rather than deleting its row outright, so
// its keys, renewal history and usage-snapshot history all survive under the
// same server_id — ready for ReviveServer if the same physical server (same
// apiUrl+cert) is ever added again. Every normal read path (ListServers,
// GetServer, ListAllServers) filters deleted_at IS NULL, so an archived
// server is indistinguishable from a hard-deleted one anywhere in the app
// except to the revive path.
func (r *Repository) DeleteServer(ctx context.Context, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	tag, err := r.pool.Exec(ctx, `UPDATE servers SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("delete server: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// MarkServerSynced records the outcome of a sync attempt. A nil syncErr clears
// any previously recorded error.
func (r *Repository) MarkServerSynced(ctx context.Context, id string, syncErr error) error {
	var errText *string
	if syncErr != nil {
		s := syncErr.Error()
		errText = &s
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE servers SET last_synced_at = now(), last_sync_error = $2, updated_at = now()
		WHERE id = $1
	`, id, errText)
	return err
}

func scanServer(row pgx.Row) (*models.Server, error) {
	var s models.Server
	if err := row.Scan(&s.ID, &s.Name, &s.APIURL, &s.CertSHA256, &s.CostUSDPerMonth, &s.LastSyncedAt, &s.LastSyncError, &s.CreatedAt, &s.UpdatedAt,
		&s.MaxKeys, &s.DefaultLimitBytes, &s.DefaultPriceMmk,
		&s.BandwidthLimitBytes, &s.BandwidthDisabledAt, &s.BandwidthReenabledAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan server: %w", err)
	}
	return &s, nil
}
