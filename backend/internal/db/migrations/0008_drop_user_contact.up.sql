-- Drops the contact fields from users. A key holder is identified by their
-- name and reached through whatever channel the admin already uses; the
-- dashboard never sent them anything, so email and phone were fields to
-- maintain with nothing reading them.
--
-- The unique index goes first: dropping the column would take it anyway, but
-- naming it here keeps the intent visible.
DROP INDEX IF EXISTS idx_users_email;

ALTER TABLE users DROP COLUMN IF EXISTS email;
ALTER TABLE users DROP COLUMN IF EXISTS phone;
