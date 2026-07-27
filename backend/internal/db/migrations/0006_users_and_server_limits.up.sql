-- Shifts the model from key-centric to user-centric. Until now a key *was*
-- the customer: the only place a person's identity lived was the key's free
-- text name, so the same person holding keys on two servers was two unrelated
-- rows. `users` makes the person the first-class record and `keys.user_id`
-- hangs their keys off it.

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    -- Contact details are optional: a user handed a key in person may have
    -- neither. Email is unique only among the rows that set it, hence the
    -- partial index below rather than a plain UNIQUE constraint (which would
    -- allow only one NULL-free row per... nothing, but reads as if NULLs
    -- collided).
    email       TEXT,
    phone       TEXT,
    note        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_email ON users(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_users_name ON users(lower(name));

-- ON DELETE SET NULL, not CASCADE: removing a user must not silently destroy
-- key records (and with them their usage history) that still exist on the
-- Outline server. The key is simply unassigned, and shows up as unlinked.
ALTER TABLE keys ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_keys_user_id ON keys(user_id);

-- How many keys an admin may create on this server. NULL = no ceiling, which
-- is what every pre-existing server gets: adding the column must not
-- retroactively cap a server that already has more keys than some default.
ALTER TABLE servers ADD COLUMN max_keys INTEGER;

-- The server-wide default quota. Applied to keys created from here on, and
-- pushed onto existing keys that have no ceiling when the admin sets it.
-- NULL = no default, so key creation falls back to the per-key plan floor.
ALTER TABLE servers ADD COLUMN default_limit_bytes BIGINT;
