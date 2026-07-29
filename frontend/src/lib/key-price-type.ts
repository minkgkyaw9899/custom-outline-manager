/**
 * Whether a key is generating revenue, mirroring the backend's
 * free_active_keys / unpriced_active_keys split (see repository.ListServers):
 * "free" means an effective price of exactly 0 (deliberate), "unpriced" means
 * no price anywhere to fall back to (a data-quality gap, not a choice), and
 * "paid" is everything else.
 */
export type KeyPriceType = "free" | "paid" | "unpriced"

/**
 * A key's own price, falling back to its server's default — the same
 * COALESCE(key.priceMmk, server.defaultPriceMmk) the backend uses for
 * monthlyRevenueMmk, so this always agrees with what the Revenue page counts.
 */
export function effectivePriceMmk(
  keyPriceMmk: number | null,
  serverDefaultPriceMmk: number | null | undefined
): number | null {
  return keyPriceMmk ?? serverDefaultPriceMmk ?? null
}

export function keyPriceType(
  keyPriceMmk: number | null,
  serverDefaultPriceMmk: number | null | undefined
): KeyPriceType {
  const effective = effectivePriceMmk(keyPriceMmk, serverDefaultPriceMmk)
  if (effective === null) return "unpriced"
  if (effective === 0) return "free"
  return "paid"
}
