-- Debounces the Telegram "possible key sharing" alert. Kept as its own table
-- rather than a column on keys (the way low_usage_alert_sent_at is): peak
-- device count is a live Outline reading, never stored on the key itself, so
-- there's no natural row to hang a column off outside of a tick that actually
-- observed a breach.
CREATE TABLE device_alerts (
    key_id UUID PRIMARY KEY REFERENCES keys(id) ON DELETE CASCADE,
    sent_at TIMESTAMPTZ NOT NULL
);
