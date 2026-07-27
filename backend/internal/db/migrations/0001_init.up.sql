CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE servers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL,
    api_url          TEXT NOT NULL,
    cert_sha256      TEXT NOT NULL,
    last_synced_at   TIMESTAMPTZ,
    last_sync_error  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (api_url)
);

CREATE TABLE keys (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id           UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    outline_key_id      TEXT NOT NULL,
    name                TEXT NOT NULL DEFAULT '',
    access_url          TEXT NOT NULL DEFAULT '',
    port                INTEGER,
    method              TEXT,
    used_bytes          BIGINT NOT NULL DEFAULT 0,
    custom_limit_bytes  BIGINT,
    end_date            TIMESTAMPTZ,
    enabled             BOOLEAN NOT NULL DEFAULT true,
    status              TEXT NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (server_id, outline_key_id)
);

CREATE INDEX idx_keys_server_id ON keys(server_id);
CREATE INDEX idx_keys_status ON keys(status);

CREATE TABLE renewal_logs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_id            UUID NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
    added_gb          NUMERIC NOT NULL DEFAULT 0,
    added_days        INTEGER NOT NULL DEFAULT 0,
    new_limit_bytes   BIGINT,
    new_end_date      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_renewal_logs_key_id ON renewal_logs(key_id);

-- Historical per-sync usage snapshots, used for bandwidth-over-date-range queries.
CREATE TABLE usage_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    server_id     UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    key_id        UUID REFERENCES keys(id) ON DELETE CASCADE,
    bytes_total   BIGINT NOT NULL,
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_snapshots_server_time ON usage_snapshots(server_id, recorded_at);
CREATE INDEX idx_usage_snapshots_key_time ON usage_snapshots(key_id, recorded_at);
