export type AdminStatus = "active" | "suspended"

export interface AdminUser {
  id: string
  email: string
  status: AdminStatus
  isRoot: boolean
  createdAt: string
  updatedAt: string
}

export type UserStatus = "active" | "inactive"

/**
 * A key holder — the person a key is handed to, as opposed to an `AdminUser`,
 * who operates this dashboard. One record per person, however many servers
 * they end up on.
 *
 * A name and a free-text note are the whole record: nothing here ever contacts
 * the holder, so there are no contact fields to keep up to date.
 */
export interface User {
  id: string
  name: string
  note: string
  status: UserStatus
  createdAt: string
  updatedAt: string
  /**
   * The key this user's dynamic link resolves to. Null for a user with no key
   * yet — their link exists but resolves to nothing.
   */
  primaryKeyId: string | null
  /**
   * The ssconf:// link to hand this user. It belongs to the person, so
   * changing which key backs them leaves it untouched. Empty when the backend
   * has no PUBLIC_BASE_URL configured.
   */
  dynamicAccessUrl: string
}

export interface UserWithKeys extends User {
  keys: Key[]
  keyCount: number
  activeKeys: number
  totalUsedBytes: number
  /**
   * The `keys` entry matching `primaryKeyId`, lifted out so the users table can
   * show one server / key name / usage / expiry per row. Null when the user
   * holds no keys.
   */
  primaryKey: Key | null
}

export type KeyStatus = "active" | "expired" | "limit_exceeded" | "disabled"

export interface Key {
  id: string
  serverId: string
  outlineKeyId: string
  name: string
  accessUrl: string
  /**
   * The ssconf:// link to share instead of accessUrl — resolves through this
   * server to the key's live connection info, so it survives Outline-side
   * key rotation. Empty when the backend has no PUBLIC_BASE_URL configured;
   * see keyShareUrl, which falls back to accessUrl in that case.
   */
  dynamicAccessUrl: string
  port: number | null
  method: string | null
  usedBytes: number
  customLimitBytes: number | null
  endDate: string | null
  /**
   * What this key sells for, in MMK. Null means no price set (falls back to
   * the server's defaultPriceMmk for revenue purposes); 0 means explicitly
   * free.
   */
  priceMmk: number | null
  enabled: boolean
  status: KeyStatus
  createdAt: string
  updatedAt: string
  daysLeft: number | null
  remainingBytes: number | null
  serverName?: string
  /** The holder this key belongs to; null for a key adopted from Outline. */
  userId: string | null
  /** Joined in on list endpoints; empty when the key has no holder. */
  userName?: string
  /**
   * Opts this key into the cron topping it up automatically once it crosses
   * the same running-low/near-expiry condition the Telegram alert uses.
   * Off by default. Each auto-renewal logs unpaid — see RenewalLog.paid.
   */
  autoRenew: boolean
}

export interface Server {
  id: string
  name: string
  apiUrl: string
  certSha256: string
  costUsdPerMonth: number | null
  lastSyncedAt: string | null
  lastSyncError: string | null
  createdAt: string
  updatedAt: string
  /**
   * How many keys may be created on this server. Null means no ceiling.
   * Enforced at creation only — lowering it below the current count blocks new
   * keys rather than deleting any.
   */
  maxKeys: number | null
  /**
   * The quota a new key on this server starts on, and the figure applied to
   * already-unlimited keys when the admin sets it. Null means no default.
   */
  defaultLimitBytes: number | null
  /**
   * What a new key on this server sells for, in MMK, unless overridden per
   * key (Key.priceMmk). Null means no default — new keys start unpriced.
   */
  defaultPriceMmk: number | null
  /**
   * A monthly transfer cap (inbound + outbound), independent of any key's
   * own data limit — this is about the hosting bill, not what any one
   * holder is allowed to use. Null means untracked.
   */
  bandwidthLimitBytes: number | null
  /**
   * Set when the cron trips the bandwidth kill switch: every key on this
   * server is forced to a 0-byte Outline limit until an admin manually
   * re-enables it. Null means not tripped.
   */
  bandwidthDisabledAt: string | null
}

export type ServerHealth = "healthy" | "degraded" | "offline"

/**
 * One autonomous system's share of a server's traffic — Outline's "ASes with
 * most bandwidth usage". This is what the design called "top operators";
 * Outline reports the AS org directly, so there is no carrier field to enter.
 */
export interface ASUsage {
  asn: number
  asOrg: string
  countryCode: string
  bytesTransferred: number
  tunnelTimeHours: number
  sharePct: number
}

/**
 * Live metrics for one server over `window`.
 *
 * Outline exposes no inbound/outbound split — only a single transfer total —
 * so `currentBandwidthBps` (a live rate) and `totalBytes` occupy the two slots
 * the design drew as Inbound/Outbound.
 */
export interface ServerMetrics {
  window: MetricsWindow
  totalBytes: number
  currentBandwidthBps: number
  peakBandwidthBps: number
  peakBandwidthAt: string | null
  tunnelTimeHours: number
  ases: ASUsage[]
  /**
   * Sum of each key's peak device count. An upper bound on simultaneous
   * devices, not a true concurrent peak — each key's peak may be from a
   * different moment.
   */
  peakDevicesTotal: number
  /**
   * Keys that moved traffic within the last 5 minutes, i.e. connected right
   * now. A snapshot, so unlike the other figures it does not scale with
   * `window`.
   */
  onlineKeys: number
}

/** One day of measured traffic, from our own snapshot history. */
export interface DailyUsage {
  date: string
  bytes: number
}

/**
 * "day" for the normal per-calendar-day chart; "hour" for a key under a day
 * old, where day buckets would show at most one point. When "hour", each
 * `DailyUsage.date` is a full timestamp rather than a plain "YYYY-MM-DD".
 */
export type UsageGranularity = "day" | "hour"

/** GET /keys/:id/daily — a key's traffic chart, at whichever granularity fits its age. */
export interface KeyUsageSeries {
  granularity: UsageGranularity
  series: DailyUsage[]
}

/** Outline rejects windows longer than 30 days. */
export type MetricsWindow = "1d" | "7d" | "30d"

/**
 * One day's revenue/cost snapshot for a server — a level (what active keys
 * are worth right now), not a delta, so a series of these is never summed,
 * only plotted or resampled to a coarser period by taking the latest of each.
 */
export interface RevenuePoint {
  date: string
  revenueMmk: number
  costUsdPerMonth: number | null
  activeKeys: number
  unpricedActiveKeys: number
}

export interface ServerWithUsage extends Server {
  hostname: string
  health: ServerHealth
  keyCount: number
  activeKeys: number
  totalUsedBytes: number
  /**
   * Sum of each active key's effective price (its own priceMmk, falling back
   * to defaultPriceMmk, else 0) — computed server-side so every consumer
   * agrees on one number.
   */
  monthlyRevenueMmk: number
  /**
   * Active keys with neither their own price nor a server default — a
   * caveat that monthlyRevenueMmk may understate actual revenue.
   */
  unpricedActiveKeys: number
  /**
   * Active keys whose effective price is explicitly 0 — deliberately free,
   * not simply unpriced. monthlyRevenueMmk already excludes them; this is
   * what explains why a server's total is less than activeKeys × price.
   */
  freeActiveKeys: number
  /** Null when the server could not be reached for a live read. */
  metrics: ServerMetrics | null
  /** Empty until the cron has recorded at least two days of snapshots. */
  dailySeries: DailyUsage[]
  /** Empty or thin until the cron has recorded enough revenue snapshots. */
  revenueDailySeries: RevenuePoint[]
  /** Transfer since the start of the current calendar month; 0 when bandwidthLimitBytes is null. */
  bandwidthUsedBytesThisMonth: number
  /** Earliest usage snapshot on file for this server, or null if none yet. */
  bandwidthTrackingSince: string | null
  /**
   * False when bandwidthTrackingSince postdates this calendar month's start
   * — bandwidthUsedBytesThisMonth is then a partial figure: the server (or
   * a key on it) was added/adopted partway through the month, so usage that
   * already happened on Outline's side before our first observation has no
   * snapshot to diff against and is invisible to us, not zero.
   */
  bandwidthTrackingComplete: boolean
}

export interface KeyMetrics {
  bytesTransferred: number
  tunnelTimeHours: number
  lastTrafficSeen: string | null
  peakDeviceCount: number
  /**
   * The VPN is in use right now: `lastTrafficSeen` falls inside the last 5
   * minutes. Computed by the backend against its own clock, matching the rule
   * Outline Manager uses for the green dot on a key.
   */
  isOnline: boolean
}

export interface ServerDetail {
  server: Server
  hostname: string
  /**
   * The host currently baked into this server's static ss:// links (Outline's
   * "hostname for access keys"). Empty when the server has no keys yet.
   */
  accessKeyHostname: string
  /** What `hostname` currently resolves to, for eyeballing DNS. Empty if the lookup failed. */
  resolvedIp: string
  health: ServerHealth
  metrics: ServerMetrics | null
  keys: Key[]
  /** Keyed by `Key.outlineKeyId`; null when metrics are unavailable. */
  keyMetrics: Record<string, KeyMetrics> | null
  /** Empty until the cron has recorded at least two days of snapshots. */
  dailySeries: DailyUsage[]
  /** Transfer since the start of the current calendar month; 0 when the server has no bandwidthLimitBytes set. */
  bandwidthUsedBytesThisMonth: number
  /** Earliest usage snapshot on file for this server, or null if none yet. */
  bandwidthTrackingSince: string | null
  /** False when bandwidthUsedBytesThisMonth is a partial figure — see ServerWithUsage's field doc. */
  bandwidthTrackingComplete: boolean
}

export interface RenewalLog {
  id: string
  keyId: string
  addedGb: number
  addedDays: number
  newLimitBytes: number | null
  newEndDate: string | null
  createdAt: string
  /** Bookkeeping only — whether payment was actually collected for this renewal. */
  paid: boolean
  paymentNote: string | null
}

export interface DashboardStats {
  totalServers: number
  totalKeys: number
  activeKeys: number
  expiredKeys: number
  limitExceededKeys: number
  combinedUsedBytes: number
}

export interface ServerUsage {
  serverId: string
  from: string
  to: string
  bytesUsed: number
}

/** Admin-editable settings (migration 0017) — MMK/USD rate + manual payment instructions. */
export interface AppSettings {
  mmkPerUsd: number
  paymentPhone: string
  paymentWallets: string[]
  updatedAt: string
}

/** Subset of AppSettings the unauthenticated /order page may fetch. */
export interface PublicPaymentInfo {
  paymentPhone: string
  paymentWallets: string[]
}

export interface DailyCount {
  date: string
  count: number
}

/** Name-only server for the public order page's location picker. */
export interface PublicServer {
  id: string
  name: string
}

export type OrderStatus = "pending" | "approved" | "rejected"

/**
 * A self-serve order submitted from the public /order page. Payment is
 * manual — nothing here verifies a transfer actually happened, an admin
 * reviews and approves/rejects from the Orders page.
 */
export interface Order {
  id: string
  customerName: string
  contact: string
  serverId: string | null
  serverName: string | null
  planGb: number
  planDays: number
  priceMmk: number | null
  paymentMethod: string
  customerNote: string
  status: OrderStatus
  adminNote: string | null
  resultingUserId: string | null
  resultingKeyId: string | null
  createdAt: string
  decidedAt: string | null
}

/**
 * Renewal-lapse rate, holder churn, and a new-holders trend over a trailing
 * window. No currency-denominated LTV — renewal_logs never stored a price
 * snapshot, so avgActiveHolderTenureDays ("how long has an active holder
 * been with us") is the honest proxy instead.
 */
export interface RetentionMetrics {
  windowDays: number
  renewedCount: number
  lapsedCount: number
  renewalLapseRatePct: number
  churnedHolders: number
  consideredHolders: number
  holderChurnRatePct: number
  newHoldersSeries: DailyCount[]
  avgActiveHolderTenureDays: number
}

/** The admin-facing "share view" link for one user. */
export interface UserShare {
  slug: string
  passcodeSet: boolean
}

export interface ShareTokenResponse {
  token: string
  expiresAt: string
}

/**
 * The trimmed, read-only payload behind a share link. Deliberately a subset
 * of `Key` + `KeyMetrics`: no port/method/outlineKeyId/server link, and no
 * renewal or limit history — those stay admin-only.
 *
 * `name` is the holder's own name, from the user record rather than the key,
 * so re-provisioning them doesn't retitle their page. When `hasKey` is false
 * they have no key attached and every figure below is empty.
 */
export interface ShareKeyView {
  name: string
  hasKey: boolean
  usedBytes: number
  customLimitBytes: number | null
  remainingBytes: number | null
  endDate: string | null
  daysLeft: number | null
  status: KeyStatus
  accessUrl: string
  dynamicAccessUrl: string
  host: string
  createdAt: string
  updatedAt: string
  metrics: KeyMetrics | null
  dailySeries: DailyUsage[]
  dailyGranularity: UsageGranularity
  /** The server's live reachability — null when there's no key, so no server to check. */
  serverHealth: ServerHealth | null
}

export interface RequestOtpResponse {
  email: string
  expiresInSeconds: number
}

export interface VerifyOtpResponse {
  admin: AdminUser
  token: string
}

export interface ApiErrorDetail {
  field: string
  message: string
}

export interface ApiError {
  code:
    | "VALIDATION_ERROR"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "BAD_GATEWAY"
    | "INTERNAL_SERVER_ERROR"
  message: string
  details?: ApiErrorDetail[]
}

export interface ApiSuccess<T> {
  success: true
  data: T
  message: string
  timestamp: string
}

export interface ApiFailure {
  success: false
  error: ApiError
  timestamp: string
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure
