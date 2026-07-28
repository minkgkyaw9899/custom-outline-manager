-- Soft-deletes servers instead of hard-deleting them, so re-adding the same
-- physical Outline server (same apiUrl + certSha256 — the common reason to
-- delete-then-re-add: an accidental delete, or wanting to rename it) can
-- revive its keys, per-key limits/expiry, renewal history, and usage-chart
-- history exactly as they were, instead of the admin starting from a blank
-- server. See handlers.createServer's revive path.
--
-- keys/renewal_logs/usage_snapshots keep cascading from servers — that's
-- still correct for a server that's truly gone forever, and irrelevant for
-- a revive, which reuses the same server row (and therefore the same
-- server_id every one of those tables hangs off) rather than deleting it.
ALTER TABLE servers ADD COLUMN deleted_at TIMESTAMPTZ;

-- Reviving a server requires matching a deleted row by api_url, and adding
-- an unrelated new server must still be free to reuse a *decommissioned*
-- server's old URL. The plain UNIQUE constraint can't tell those apart from
-- a real duplicate; this partial index only enforces uniqueness among
-- servers that are still active.
ALTER TABLE servers DROP CONSTRAINT servers_api_url_key;
CREATE UNIQUE INDEX idx_servers_api_url_active ON servers(api_url) WHERE deleted_at IS NULL;
