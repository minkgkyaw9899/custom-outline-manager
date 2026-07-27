package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"outline-manager/internal/authn"
	"outline-manager/internal/models"
)

// errDuplicateDynamicToken is internal to this file: CreateUser retries on it
// rather than surfacing it, since it means our own RNG repeated itself.
var errDuplicateDynamicToken = errors.New("dynamic token already in use")

const userColumns = `id, name, note, status, created_at, updated_at, primary_key_id, dynamic_token`

// CreateUser registers a key holder, minting the dynamic-access token their
// ssconf:// link is built from. The retry loop mirrors CreateKey's: a
// collision on 128 bits of entropy is not something that happens, it is only
// guarded against a pathological RNG failure.
func (r *Repository) CreateUser(ctx context.Context, name, note string, status models.UserStatus) (*models.User, error) {
	var lastErr error
	for i := 0; i < maxDynamicTokenAttempts; i++ {
		token, err := authn.GenerateSlug()
		if err != nil {
			return nil, fmt.Errorf("generate dynamic token: %w", err)
		}
		row := r.pool.QueryRow(ctx, `
			INSERT INTO users (name, note, status, dynamic_token)
			VALUES ($1, $2, $3, $4)
			RETURNING `+userColumns, name, note, status, token)
		user, err := scanUser(row)
		if err == nil {
			return user, nil
		}
		if errors.Is(err, errDuplicateDynamicToken) {
			lastErr = err
			continue
		}
		return nil, err
	}
	return nil, fmt.Errorf("create user: %w", lastErr)
}

func (r *Repository) GetUser(ctx context.Context, id string) (*models.User, error) {
	if !isUUID(id) {
		return nil, ErrNotFound
	}
	row := r.pool.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE id = $1`, id)
	return scanUser(row)
}

// ListUsers returns every user with their key counts rolled up in SQL, so the
// users table renders without a per-row query. The keys themselves are not
// loaded here — the list only needs the counters, plus the one primary key per
// row that ListPrimaryKeys fetches alongside it.
func (r *Repository) ListUsers(ctx context.Context) ([]models.UserWithKeys, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT u.id, u.name, u.note, u.status, u.created_at, u.updated_at,
		       u.primary_key_id, u.dynamic_token,
		       COUNT(k.id) AS key_count,
		       COUNT(k.id) FILTER (WHERE k.status = 'active') AS active_keys,
		       COALESCE(SUM(k.used_bytes), 0) AS total_used_bytes
		FROM users u
		LEFT JOIN keys k ON k.user_id = u.id
		GROUP BY u.id
		ORDER BY u.created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	out := make([]models.UserWithKeys, 0)
	for rows.Next() {
		var u models.UserWithKeys
		if err := rows.Scan(&u.ID, &u.Name, &u.Note, &u.Status, &u.CreatedAt, &u.UpdatedAt,
			&u.PrimaryKeyID, &u.DynamicToken,
			&u.KeyCount, &u.ActiveKeys, &u.TotalUsedBytes); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		u.Keys = []models.Key{}
		out = append(out, u)
	}
	return out, rows.Err()
}

// ListPrimaryKeys returns every user's nominated key, so the users table can
// show one server / key name / usage / expiry per row from two queries rather
// than one per user. Users without a key are simply absent, and each key
// carries its own user_id, which is what the caller keys the result by.
func (r *Repository) ListPrimaryKeys(ctx context.Context) ([]models.Key, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+keyColumns+`, s.name
		FROM users u
		JOIN keys k ON k.id = u.primary_key_id
		JOIN servers s ON s.id = k.server_id
	`)
	if err != nil {
		return nil, fmt.Errorf("list primary keys: %w", err)
	}
	defer rows.Close()
	return collectKeys(rows, keyJoins{serverName: true})
}

// GetUserByDynamicToken resolves the token in a user's ssconf:// link, for the
// public GET /api/v1/dkey/:token endpoint.
func (r *Repository) GetUserByDynamicToken(ctx context.Context, token string) (*models.User, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE dynamic_token = $1`, token)
	return scanUser(row)
}

// SetUserPrimaryKey nominates which of a user's keys their dynamic link
// resolves to, or clears it when keyID is nil. Callers are responsible for
// having checked the key actually belongs to this user.
func (r *Repository) SetUserPrimaryKey(ctx context.Context, id string, keyID *string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	tag, err := r.pool.Exec(ctx, `UPDATE users SET primary_key_id = $2, updated_at = now() WHERE id = $1`, id, keyID)
	if err != nil {
		return fmt.Errorf("set user primary key: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AdoptPrimaryKeyIfUnset points a user at keyID only when they have no primary
// key yet, so a holder's first key becomes the one their link resolves to
// without a later key silently stealing the nomination.
func (r *Repository) AdoptPrimaryKeyIfUnset(ctx context.Context, userID, keyID string) error {
	if !isUUID(userID) || !isUUID(keyID) {
		return ErrNotFound
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE users SET primary_key_id = $2, updated_at = now()
		WHERE id = $1 AND primary_key_id IS NULL
	`, userID, keyID)
	if err != nil {
		return fmt.Errorf("adopt primary key: %w", err)
	}
	return nil
}

// UpdateUser applies a partial edit: a nil argument leaves that column alone.
// A note can be blanked by passing a pointer to an empty string, which is a
// meaningful value rather than "don't touch".
func (r *Repository) UpdateUser(ctx context.Context, id string, name, note *string, status *models.UserStatus) (*models.User, error) {
	if !isUUID(id) {
		return nil, ErrNotFound
	}
	row := r.pool.QueryRow(ctx, `
		UPDATE users SET
			name = COALESCE($2, name),
			note = COALESCE($3, note),
			status = COALESCE($4, status),
			updated_at = now()
		WHERE id = $1
		RETURNING `+userColumns, id, name, note, status)
	return scanUser(row)
}

func (r *Repository) DeleteUser(ctx context.Context, id string) error {
	if !isUUID(id) {
		return ErrNotFound
	}
	// keys.user_id is ON DELETE SET NULL, so the user's keys survive as
	// unassigned rather than being destroyed along with the record.
	tag, err := r.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func scanUser(row pgx.Row) (*models.User, error) {
	var u models.User
	if err := row.Scan(&u.ID, &u.Name, &u.Note, &u.Status, &u.CreatedAt, &u.UpdatedAt,
		&u.PrimaryKeyID, &u.DynamicToken); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		if uniqueConstraintName(err) == "idx_users_dynamic_token" {
			return nil, errDuplicateDynamicToken
		}
		return nil, fmt.Errorf("scan user: %w", err)
	}
	return &u, nil
}
