-- Per-user activity log: every account/key action a holder's admin takes,
-- shown as a timeline on the user detail page. One row per action, newest
-- first. user_id cascades on user delete since the log has no meaning once
-- the account is gone; key_id is kept nullable + SET NULL so a deleted key
-- doesn't erase the history of what happened to it.
CREATE TABLE user_activity_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id       UUID REFERENCES keys(id) ON DELETE SET NULL,
    -- e.g. auto_renew, manual_renew, reset_usage, change_key, link_key,
    -- unlink_key, set_primary_key, key_updated, auto_renew_toggled,
    -- user_created, user_updated, user_deleted.
    action_type  TEXT NOT NULL,
    -- Free-text summary for display, e.g. "Renewed +50 GB / 30 days".
    detail       TEXT NOT NULL DEFAULT '',
    -- Structured before/after values (added_gb, added_days, new_limit_bytes,
    -- new_end_date, old/new key id, etc.) — kept as JSON so each action type
    -- can carry whatever fields are relevant without a wide sparse table.
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Admin email who performed it. Null for actions the cron job took
    -- (auto-renew, auto-disable on expiry/limit) since there's no operator.
    actor_email  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_activity_log_user_id ON user_activity_log(user_id, created_at DESC);
CREATE INDEX idx_user_activity_log_key_id ON user_activity_log(key_id);
