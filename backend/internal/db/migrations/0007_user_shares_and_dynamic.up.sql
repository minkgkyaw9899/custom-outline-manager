-- Moves the two things a key holder actually receives — the ssconf:// dynamic
-- access link and the passcode-gated status page — from the key onto the user.
--
-- Until now both were keyed to a key, so re-provisioning someone (new server,
-- fresh key) meant redistributing their link and resetting their status page.
-- Hanging them off the user instead makes the key an implementation detail the
-- admin can swap underneath a holder who never sees the change.

-- The token in the user's ssconf:// link. Same shape and purpose as
-- keys.dynamic_token (see 0005), just one level up; keys keep theirs so links
-- already handed out from the key page keep resolving.
ALTER TABLE users ADD COLUMN dynamic_token TEXT;
UPDATE users SET dynamic_token = encode(gen_random_bytes(16), 'hex') WHERE dynamic_token IS NULL;
ALTER TABLE users ALTER COLUMN dynamic_token SET NOT NULL;
CREATE UNIQUE INDEX idx_users_dynamic_token ON users(dynamic_token);

-- Which of the user's keys their dynamic link resolves to. A user may hold
-- keys on several servers, but ssconf:// resolves to exactly one connection,
-- so one of them has to be nominated. ON DELETE SET NULL, not CASCADE: deleting
-- a key must leave the user standing (with a dead link until a new key is
-- attached), never delete the person.
ALTER TABLE users ADD COLUMN primary_key_id UUID REFERENCES keys(id) ON DELETE SET NULL;

-- Existing holders get their oldest key as primary — for the one-key-per-user
-- case that every current row is, that is simply "their key".
UPDATE users u SET primary_key_id = first_key.id
FROM (
    SELECT DISTINCT ON (user_id) id, user_id
    FROM keys WHERE user_id IS NOT NULL
    ORDER BY user_id, created_at ASC
) AS first_key
WHERE first_key.user_id = u.id;

CREATE TABLE user_shares (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    slug             TEXT NOT NULL UNIQUE,
    passcode_hash    TEXT,
    passcode_set_at  TIMESTAMPTZ,
    failed_attempts  INTEGER NOT NULL DEFAULT 0,
    locked_until     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_shares_slug ON user_shares(slug);

-- Carry over the share links of keys that already have a holder, passcode and
-- slug included, so nobody has to re-set a passcode or be sent a new URL. A
-- holder with shares on two keys keeps whichever lands first; the other is
-- dropped with the table below, which is the point of the move.
INSERT INTO user_shares (user_id, slug, passcode_hash, passcode_set_at, created_at)
SELECT k.user_id, ks.slug, ks.passcode_hash, ks.passcode_set_at, ks.created_at
FROM key_shares ks
JOIN keys k ON k.id = ks.key_id
WHERE k.user_id IS NOT NULL
ON CONFLICT DO NOTHING;

DROP TABLE key_shares;
