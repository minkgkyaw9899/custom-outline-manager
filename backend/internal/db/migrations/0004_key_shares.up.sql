CREATE TABLE key_shares (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_id           UUID NOT NULL UNIQUE REFERENCES keys(id) ON DELETE CASCADE,
    slug             TEXT NOT NULL UNIQUE,
    passcode_hash    TEXT,
    passcode_set_at  TIMESTAMPTZ,
    failed_attempts  INTEGER NOT NULL DEFAULT 0,
    locked_until     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_key_shares_slug ON key_shares(slug);
