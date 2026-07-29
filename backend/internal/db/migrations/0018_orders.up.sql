-- Self-serve orders submitted from the public /order page. Payment is
-- manual (bank/mobile-money transfer to the phone number in app_settings) —
-- there is no payment-gateway integration, so nothing here verifies a
-- transfer actually happened. An admin reviews each pending row and either
-- approves it (provisioning a user+key, same as the "add user" admin flow)
-- or rejects it.
CREATE TABLE orders (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name      TEXT NOT NULL,
    contact            TEXT NOT NULL,
    -- Nullable + ON DELETE SET NULL: an order references a server only to
    -- suggest which one to provision on. If that server is later archived,
    -- the order (especially a decided one, kept as a historical record)
    -- should not disappear or block the server's deletion.
    server_id          UUID REFERENCES servers(id) ON DELETE SET NULL,
    plan_gb            NUMERIC NOT NULL,
    plan_days          INTEGER NOT NULL,
    price_mmk          BIGINT,
    payment_method     TEXT NOT NULL DEFAULT '',
    customer_note      TEXT NOT NULL DEFAULT '',
    status             TEXT NOT NULL DEFAULT 'pending',
    admin_note         TEXT,
    resulting_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    resulting_key_id   UUID REFERENCES keys(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at         TIMESTAMPTZ
);

CREATE INDEX idx_orders_status ON orders(status);
