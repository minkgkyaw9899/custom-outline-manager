package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"outline-manager/internal/models"
)

const adminColumns = `id, email, status, created_at, updated_at`

// ErrAlreadyExists is returned when an insert would violate a uniqueness
// constraint the caller should surface as 409 Conflict rather than 500.
var ErrAlreadyExists = errors.New("already exists")

func (r *Repository) GetAdminByEmail(ctx context.Context, email string) (*models.AdminUser, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+adminColumns+` FROM admin_users WHERE email = $1`, email)
	return scanAdmin(row)
}

func (r *Repository) CreateAdmin(ctx context.Context, email string) (*models.AdminUser, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO admin_users (email) VALUES ($1)
		RETURNING `+adminColumns, email)
	admin, err := scanAdmin(row)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrAlreadyExists
		}
		return nil, err
	}
	return admin, nil
}

func (r *Repository) ListAdmins(ctx context.Context) ([]models.AdminUser, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+adminColumns+` FROM admin_users ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list admins: %w", err)
	}
	defer rows.Close()

	out := make([]models.AdminUser, 0)
	for rows.Next() {
		var a models.AdminUser
		if err := rows.Scan(&a.ID, &a.Email, &a.Status, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan admin: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repository) DeleteAdminByEmail(ctx context.Context, email string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM admin_users WHERE email = $1`, email)
	if err != nil {
		return fmt.Errorf("delete admin: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) SetAdminStatus(ctx context.Context, email string, status models.AdminStatus) error {
	tag, err := r.pool.Exec(ctx, `UPDATE admin_users SET status = $2, updated_at = now() WHERE email = $1`, email, status)
	if err != nil {
		return fmt.Errorf("set admin status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func scanAdmin(row pgx.Row) (*models.AdminUser, error) {
	var a models.AdminUser
	if err := row.Scan(&a.ID, &a.Email, &a.Status, &a.CreatedAt, &a.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan admin: %w", err)
	}
	return &a, nil
}

// isUniqueViolation checks for Postgres SQLSTATE 23505 (unique_violation),
// unwrapping through any %w-wrapped chain to find it.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// uniqueConstraintName is the index a unique violation tripped, or "" if err
// is not one. Callers need it when a table has more than one unique column and
// they have to treat them differently — a duplicate email is the operator's
// mistake to report, a duplicate random token is ours to retry.
func uniqueConstraintName(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return pgErr.ConstraintName
	}
	return ""
}
