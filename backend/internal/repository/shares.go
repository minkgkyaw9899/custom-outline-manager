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

const shareColumns = `id, user_id, slug, passcode_hash, passcode_set_at, failed_attempts, locked_until, created_at, updated_at`

// maxSlugAttempts bounds the retry loop for a colliding slug. A collision on
// 128 bits of random entropy is astronomically unlikely; this only guards
// against a pathological RNG failure rather than any expected contention.
const maxSlugAttempts = 5

// GetOrCreateShareForUser returns the user's existing share link, creating one
// with a fresh random slug on first request. One share row per user: a second
// concurrent create races on the user_id unique constraint, in which case the
// loser just re-reads the winner's row.
//
// Scoped to the user, not the key, so re-provisioning someone onto a different
// server keeps both the URL they were given and the passcode they set.
func (r *Repository) GetOrCreateShareForUser(ctx context.Context, userID string) (*models.UserShare, error) {
	if existing, err := r.GetShareByUserID(ctx, userID); err == nil {
		return existing, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	var lastErr error
	for i := 0; i < maxSlugAttempts; i++ {
		slug, err := authn.GenerateSlug()
		if err != nil {
			return nil, fmt.Errorf("generate share slug: %w", err)
		}

		row := r.pool.QueryRow(ctx, `
			INSERT INTO user_shares (user_id, slug) VALUES ($1, $2)
			RETURNING `+shareColumns, userID, slug)
		share, err := scanShare(row)
		if err == nil {
			return share, nil
		}
		if isUniqueViolation(err) {
			// Either the slug collided (retry with a new one) or a concurrent
			// request already created this user's share (return that one).
			if existing, gerr := r.GetShareByUserID(ctx, userID); gerr == nil {
				return existing, nil
			}
			lastErr = err
			continue
		}
		return nil, err
	}
	return nil, fmt.Errorf("create share: %w", lastErr)
}

func (r *Repository) GetShareByUserID(ctx context.Context, userID string) (*models.UserShare, error) {
	if !isUUID(userID) {
		return nil, ErrNotFound
	}
	row := r.pool.QueryRow(ctx, `SELECT `+shareColumns+` FROM user_shares WHERE user_id = $1`, userID)
	return scanShare(row)
}

func (r *Repository) GetShareBySlug(ctx context.Context, slug string) (*models.UserShare, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+shareColumns+` FROM user_shares WHERE slug = $1`, slug)
	return scanShare(row)
}

// SetSharePasscode records the holder's first-visit passcode. Attempts and any
// lockout are cleared, since this is a fresh credential.
func (r *Repository) SetSharePasscode(ctx context.Context, id, passcodeHash string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE user_shares
		SET passcode_hash = $2, passcode_set_at = now(), failed_attempts = 0, locked_until = NULL, updated_at = now()
		WHERE id = $1
	`, id, passcodeHash)
	return err
}

// ResetSharePasscode is the admin's "holder forgot their passcode" action: it
// clears the passcode entirely, so the public page falls back to the setup
// screen on the holder's next visit.
func (r *Repository) ResetSharePasscode(ctx context.Context, userID string) error {
	if !isUUID(userID) {
		return ErrNotFound
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE user_shares
		SET passcode_hash = NULL, passcode_set_at = NULL, failed_attempts = 0, locked_until = NULL, updated_at = now()
		WHERE user_id = $1
	`, userID)
	if err != nil {
		return fmt.Errorf("reset share passcode: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// RecordShareFailure counts a wrong passcode attempt, locking the link out
// until lockUntil once maxAttempts is reached. The caller computes lockUntil
// (time.Now().Add(lockFor)) so no duration-to-interval parsing happens in SQL.
func (r *Repository) RecordShareFailure(ctx context.Context, id string, maxAttempts int, lockUntil time.Time) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE user_shares
		SET failed_attempts = failed_attempts + 1,
		    locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN $3::timestamptz ELSE locked_until END,
		    updated_at = now()
		WHERE id = $1
	`, id, maxAttempts, lockUntil)
	return err
}

// ResetShareFailures clears the attempt counter after a correct passcode.
func (r *Repository) ResetShareFailures(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE user_shares SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1
	`, id)
	return err
}

func scanShare(row pgx.Row) (*models.UserShare, error) {
	var s models.UserShare
	if err := row.Scan(&s.ID, &s.UserID, &s.Slug, &s.PasscodeHash, &s.PasscodeSetAt, &s.FailedAttempts, &s.LockedUntil, &s.CreatedAt, &s.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan share: %w", err)
	}
	return &s, nil
}
