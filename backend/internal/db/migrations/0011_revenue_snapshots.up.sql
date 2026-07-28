-- Daily revenue/cost snapshots, recorded each cron tick so a real trend chart
-- becomes possible over time — same idea as usage_snapshots for bandwidth,
-- except revenue isn't a cumulative counter: each row is already the
-- point-in-time monthly-revenue figure (sum of active keys' effective
-- prices), not a delta to compute. Daily/monthly/yearly views are read by
-- taking the latest snapshot within each period, not by summing them.
--
-- cost_usd_per_month is stored in USD, not MMK: the MMK_PER_USD conversion
-- rate is a frontend-only constant (see add-server-dialog.tsx), so it stays
-- in USD here and gets converted at render time, same as the live figure.
CREATE TABLE revenue_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revenue_mmk BIGINT NOT NULL,
    cost_usd_per_month DOUBLE PRECISION,
    active_keys INT NOT NULL,
    unpriced_active_keys INT NOT NULL
);

CREATE INDEX idx_revenue_snapshots_server_id ON revenue_snapshots(server_id, recorded_at);
