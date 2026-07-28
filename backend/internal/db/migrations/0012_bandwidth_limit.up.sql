-- A monthly bandwidth cap (inbound + outbound), independent of any key's own
-- data limit — this is about the hosting bill, not what any one holder is
-- allowed to use. NULL means no cap tracked.
ALTER TABLE servers ADD COLUMN bandwidth_limit_bytes BIGINT;

-- Set when the cron trips the cap (current calendar month's transfer within
-- 2 GB of bandwidth_limit_bytes): every key on the server gets forced to a
-- 0-byte Outline data limit regardless of its own plan, without touching the
-- key's own custom_limit_bytes/end_date/enabled bookkeeping — this is a
-- network-level kill switch, not a plan change. NULL = not tripped.
-- Re-enabling is a manual admin action (POST /servers/:id/bandwidth/enable)
-- that clears this and restores every key's real computed state; nothing
-- clears it automatically, even once the calendar month rolls over.
ALTER TABLE servers ADD COLUMN bandwidth_disabled_at TIMESTAMPTZ;

-- Timestamp of the last manual re-enable, so the cron doesn't immediately
-- re-trip the same server on its very next tick while usage is still over
-- the cap in the same calendar month the admin already overrode it in — it
-- only re-arms once a new month starts.
ALTER TABLE servers ADD COLUMN bandwidth_reenabled_at TIMESTAMPTZ;
