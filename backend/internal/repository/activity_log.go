package repository

import (
	"context"
	"fmt"

	"outline-manager/internal/models"
)

const activityLogColumns = `id, user_id, key_id, action_type, detail, metadata, actor_email, created_at`

// InsertActivityLog records one audit entry for a user (and optionally a
// specific key). metadata may be nil, in which case it's stored as "{}".
func (r *Repository) InsertActivityLog(ctx context.Context, userID string, keyID *string, actionType, detail string, metadata []byte, actorEmail *string) (*models.ActivityLog, error) {
	if metadata == nil {
		metadata = []byte("{}")
	}
	row := r.pool.QueryRow(ctx, `
		INSERT INTO user_activity_log (user_id, key_id, action_type, detail, metadata, actor_email)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+activityLogColumns,
		userID, keyID, actionType, detail, metadata, actorEmail,
	)

	var l models.ActivityLog
	if err := row.Scan(&l.ID, &l.UserID, &l.KeyID, &l.ActionType, &l.Detail, &l.Metadata, &l.ActorEmail, &l.CreatedAt); err != nil {
		return nil, fmt.Errorf("insert activity log: %w", err)
	}
	return &l, nil
}

// ListActivityLog returns a user's audit trail, newest first.
func (r *Repository) ListActivityLog(ctx context.Context, userID string) ([]models.ActivityLog, error) {
	if !isUUID(userID) {
		return nil, ErrNotFound
	}

	rows, err := r.pool.Query(ctx, `
		SELECT `+activityLogColumns+`
		FROM user_activity_log
		WHERE user_id = $1
		ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list activity log: %w", err)
	}
	defer rows.Close()

	var out []models.ActivityLog
	for rows.Next() {
		var l models.ActivityLog
		if err := rows.Scan(&l.ID, &l.UserID, &l.KeyID, &l.ActionType, &l.Detail, &l.Metadata, &l.ActorEmail, &l.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan activity log: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}
