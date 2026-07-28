-- Opt-in per key: when true, the cron tops the key up automatically once it
-- crosses the same "running low" condition the Telegram alert uses, instead
-- of waiting for the admin to renew it by hand. The renewal is logged as
-- unpaid so it still shows up as needing payment confirmation — auto-renew
-- keeps service continuous, it does not decide the money was collected.
ALTER TABLE keys ADD COLUMN auto_renew BOOLEAN NOT NULL DEFAULT false;
