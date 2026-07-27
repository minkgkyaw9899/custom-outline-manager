package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"outline-manager/internal/models"
)

const serverColumns = `id, name, api_url, cert_sha256, cost_usd_per_month, last_synced_at, last_sync_error, created_at, updated_at, max_keys, default_limit_bytes`

func (r *Repository) CreateServer(ctx context.Context, name, apiURL, certSHA256 string, costUSDPerMonth *float64, maxKeys *int, defaultLimitBytes *int64) (*models.Server, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO servers (name, api_url, cert_sha256, cost_usd_per_month, max_keys, default_limit_bytes)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+serverColumns, name, apiURL, certSHA256, costUSDPerMonth, maxKeys, defaultLimitBytes)
	return scanServer(row)
}

// UpdateServerDetails writes the admin-editable metadata. Each argument is
// nil-to-skip, so the handler can send only what the dialog actually changed
// and a partial update never blanks a field it wasn't asked about. The one
// thing it cannot express is clearing cost/max-keys back to NULL — see
// ClearServerLimit and the handler's explicit-null handling.
func (r *Repository) UpdateServerDetails(ctx context.Context, id string, name *string, costUSDPerMonth *float64, maxKeys *int) (*models.Server, error) {
	if !isUUID(id) {
		return nil, ErrNotFound
	}
	row := r.pool.QueryRow(ctx, `
		UPDATE servers SET
			name = COALESCE($2, name),
			cost_usd_per_month = COALESCE($3, cost_usd_per_month),
			max_keys = COALESCE($4, max_keys),
			updated_at = now()
		WHERE id = $1
		RETURNING `+serverColumns, id, name, costUSDPerMonth, maxKeys)
	return scanServer(row)
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
		       s.max_keys, s.default_limit_bytes,
		       COUNT(k.id) AS key_count,
		       COUNT(k.id) FILTER (WHERE k.status = 'active') AS active_keys,
		       COALESCE(SUM(k.used_bytes), 0) AS total_used_bytes
		FROM servers s
		LEFT JOIN keys k ON k.server_id = s.id
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
			&s.MaxKeys, &s.DefaultLimitBytes,
			&s.KeyCount, &s.ActiveKeys, &s.TotalUsedBytes); err != nil {
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
	row := r.pool.QueryRow(ctx, `SELECT `+serverColumns+` FROM servers WHERE id = $1`, id)
	return scanServer(row)
}

// ListAllServers returns bare server rows, for the cron loop.
func (r *Repository) ListAllServers(ctx context.Context) ([]models.Server, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+serverColumns+` FROM servers ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list all servers: %w", err)
	}
	defer rows.Close()

	out := make([]models.Server, 0)
	for rows.Next() {
		var s models.Server
		if err := rows.Scan(&s.ID, &s.Name, &s.APIURL, &s.CertSHA256, &s.CostUSDPerMonth, &s.LastSyncedAt, &s.LastSyncError, &s.CreatedAt, &s.UpdatedAt,
			&s.MaxKeys, &s.DefaultLimitBytes); err != nil {
			return nil, fmt.Errorf("scan server: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *Repository) DeleteServer(ctx context.Context, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM servers WHERE id = $1`, id)
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
		&s.MaxKeys, &s.DefaultLimitBytes); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan server: %w", err)
	}
	return &s, nil
}
