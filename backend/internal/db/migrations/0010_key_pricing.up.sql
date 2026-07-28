-- What a key is actually sold for, in MMK — the currency keys are sold in,
-- unlike servers.cost_usd_per_month which is the USD hosting expense. Kept
-- as a separate currency rather than converted through MMK_PER_USD: hosting
-- cost is a real USD bill: what a key sells for is a price the admin sets
-- directly in MMK and isn't derived from anything.
--
-- Nullable, mirroring default_limit_bytes/custom_limit_bytes: NULL means "no
-- price set" (revenue for that key is unknown, not zero), distinct from an
-- explicit 0, which means the key is genuinely free — e.g. handed to family
-- rather than sold. A key's own price_mmk overrides its server's
-- default_price_mmk; new keys are seeded from the server's default at
-- creation time (see handlers.provisionKey), the same way a new key already
-- inherits the server's default data limit.
ALTER TABLE servers ADD COLUMN default_price_mmk BIGINT;
ALTER TABLE keys ADD COLUMN price_mmk BIGINT;
