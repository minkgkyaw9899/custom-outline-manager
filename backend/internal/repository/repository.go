// Package repository contains all SQL access. Handlers and the enforcement
// job depend only on this package, never on pgx directly.
//
// The queries are split across files by aggregate: servers.go, keys.go,
// renewals.go and usage.go.
package repository

import (
	"context"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned instead of pgx.ErrNoRows so the HTTP layer can map
// "missing row" to 404 without importing pgx.
var ErrNotFound = errors.New("not found")

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// Ping checks that the database is reachable, for the health endpoint.
func (r *Repository) Ping(ctx context.Context) error {
	return r.pool.Ping(ctx)
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// isUUID guards lookups on UUID primary keys. Without it, a garbage path
// parameter reaches Postgres as an invalid-input error and surfaces as a 500
// instead of the 404 the client should see.
func isUUID(s string) bool { return uuidPattern.MatchString(s) }
