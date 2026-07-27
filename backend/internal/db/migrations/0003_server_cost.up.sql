-- Monthly instance cost, admin-entered when the server is added. Feeds the
-- "$7/mo" subtitle on the servers list and the Revenue page's cost side.
-- Nullable because servers added before this migration have no recorded cost;
-- the UI shows "—" rather than pretending the cost is zero.
ALTER TABLE servers ADD COLUMN cost_usd_per_month NUMERIC(10, 2);
