-- Debounces the Telegram low-usage/near-expiry alert: a key already alerted
-- recently isn't re-alerted every cron tick while the condition persists.
-- NULL means never alerted. Cleared implicitly by nothing — a renewal simply
-- moves the key back out of the trigger condition, which is what stops
-- further alerts; the timestamp itself is left as history.
ALTER TABLE keys ADD COLUMN low_usage_alert_sent_at TIMESTAMPTZ;
