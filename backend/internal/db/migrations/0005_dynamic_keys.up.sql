-- Dynamic Access Keys (https://developer.getoutline.org/vpn/management/dynamic-access-keys):
-- rather than handing out the raw ss:// link, we hand out an ssconf:// link
-- pointing back at this server, which resolves to the key's live connection
-- info via GET /api/v1/dkey/:dynamic_token. That needs the plaintext
-- password (Outline's accessUrl embeds it, but only base64-encoded together
-- with the method) and a stable, unguessable, non-enumerable token per key.

ALTER TABLE keys ADD COLUMN password TEXT NOT NULL DEFAULT '';
ALTER TABLE keys ADD COLUMN dynamic_token TEXT;

-- Backfill existing rows with a random token (Go generates url-safe base64
-- for every row created from here on; this one-off backfill uses hex, which
-- is just as unguessable and needs no extra encoding step in SQL).
UPDATE keys SET dynamic_token = encode(gen_random_bytes(16), 'hex') WHERE dynamic_token IS NULL;

ALTER TABLE keys ALTER COLUMN dynamic_token SET NOT NULL;
CREATE UNIQUE INDEX idx_keys_dynamic_token ON keys(dynamic_token);

-- password stays blank for pre-existing rows until their next sync (every
-- Outline-owned field is refreshed by UpsertKeyFromOutline on each cron
-- tick, same as access_url/port/method already were).
