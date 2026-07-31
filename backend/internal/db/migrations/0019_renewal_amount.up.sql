-- Snapshots what a renewal was worth at the moment it was applied, so the
-- revenue detail page can show actual incoming amounts per renewal event
-- instead of only today's point-in-time revenue level. NULL for rows that
-- predate this column and for non-billable "set exact" adjustments — only
-- RenewKey (manual extend and auto-renew) ever sets it.
ALTER TABLE renewal_logs ADD COLUMN amount_mmk BIGINT;
