-- Singleton settings row (the `id BOOLEAN ... CHECK (id)` trick guarantees at
-- most one row ever exists). Replaces two things that used to be hardcoded:
-- the frontend's MMK_PER_USD constant (used to convert cost_usd_per_month
-- into MMK for profit math), and the payment instructions shown on the
-- public order page (§ self-serve orders) — a phone number plus which mobile
-- wallets are accepted, since payment collection here is manual bank/mobile
-- transfer, not a payment-gateway integration.
CREATE TABLE app_settings (
    id               BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    mmk_per_usd      NUMERIC NOT NULL DEFAULT 4500,
    payment_phone    TEXT NOT NULL DEFAULT '',
    payment_wallets  TEXT[] NOT NULL DEFAULT '{}',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id, mmk_per_usd, payment_phone, payment_wallets)
VALUES (
    true,
    4500,
    '09762637636',
    ARRAY['KBZ Pay', 'UAB Pay', 'AYA Pay', 'CB Pay', 'CTZ Pay', 'MTB Pay', 'Wave Money', 'A+']
)
ON CONFLICT (id) DO NOTHING;
