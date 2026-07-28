-- Whether a renewal's payment was actually collected, plus a free-text note.
-- Defaults true: existing rows predate this feature and were real renewals
-- already trusted as paid, so backfilling them as "unpaid" would be a false
-- flag rather than a real signal. New code paths decide their own value
-- explicitly instead of relying on this default.
ALTER TABLE renewal_logs ADD COLUMN paid BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE renewal_logs ADD COLUMN payment_note TEXT;
