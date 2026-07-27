// Design fixture for the server detail screen, mounted at /servers/mock while
// the layout is being settled (see docs/DESIGN_HANDOFF.md — screens are agreed
// against mock data first, then wired to the real endpoints).
//
// The store is deliberately mutable: create / top up / delete act on it, so the
// mock page exercises the same dialogs and confirmations as the live one
// without touching a real Outline server. Dev only — `mockServerDetail` is
// never reachable from a real server id.

import type { DailyUsage, Key, KeyMetrics, KeyStatus, KeyUsageSeries, ServerDetail } from "./types"
import { BYTES_PER_GB, MIN_PLAN_DAYS, MIN_PLAN_GB } from "./format"

export const MOCK_SERVER_ID = "mock"

/** True for the mock server and for any key belonging to it. */
export function isMockId(id: string): boolean {
  return id === MOCK_SERVER_ID || id.startsWith("mockkey-")
}

const GB = BYTES_PER_GB
const now = () => new Date()
const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString()
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString()

// Matches the backend's sparklineDays / keyDailyDays, so the mock charts cover
// the same span as the live ones.
const MOCK_DAILY_DAYS = 14

/** A deterministic-looking wobble around `avgBytesPerDay`, oldest day first. */
function mockDailySeries(avgBytesPerDay: number, days = MOCK_DAILY_DAYS): DailyUsage[] {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString()
    const wobble = 0.55 + 0.35 * Math.sin(i * 1.3) + (i % 3 === 0 ? 0.2 : 0)
    return { date, bytes: Math.max(0, Math.round(avgBytesPerDay * wobble)) }
  })
}

interface Seed {
  name: string
  usedGb: number
  limitGb: number | null
  endInDays: number | null
  status: KeyStatus
  onlineMinutesAgo: number | null
  tunnelTimeHours: number
  peakDeviceCount: number
}

// Twelve keys so the default page size (10) actually pages. Every limit is at
// or above the 200 GB plan floor, because no key is sold for less.
const SEEDS: Seed[] = [
  { name: "Aung — Monthly 200GB", usedGb: 142.6, limitGb: 200, endInDays: 20, status: "active", onlineMinutesAgo: 1, tunnelTimeHours: 61.4, peakDeviceCount: 3 },
  { name: "Thida — Family 500GB", usedGb: 232, limitGb: 500, endInDays: 39, status: "active", onlineMinutesAgo: 3, tunnelTimeHours: 128.2, peakDeviceCount: 5 },
  { name: "Ko Ko — Monthly 200GB", usedGb: 191.4, limitGb: 200, endInDays: 3, status: "active", onlineMinutesAgo: 42, tunnelTimeHours: 12.75, peakDeviceCount: 1 },
  { name: "Zaw — Monthly 200GB", usedGb: 200, limitGb: 200, endInDays: 25, status: "limit_exceeded", onlineMinutesAgo: null, tunnelTimeHours: 88.0, peakDeviceCount: 2 },
  { name: "Nyein — Monthly 200GB", usedGb: 162.4, limitGb: 200, endInDays: -13, status: "expired", onlineMinutesAgo: null, tunnelTimeHours: 30.5, peakDeviceCount: 2 },
  { name: "May — Yearly 1TB", usedGb: 287, limitGb: 1024, endInDays: 229, status: "active", onlineMinutesAgo: 2, tunnelTimeHours: 214.6, peakDeviceCount: 4 },
  { name: "Htet — Monthly 200GB", usedGb: 18.9, limitGb: 200, endInDays: 27, status: "active", onlineMinutesAgo: 900, tunnelTimeHours: 9.2, peakDeviceCount: 1 },
  { name: "Su Su — Family 500GB", usedGb: 411.3, limitGb: 500, endInDays: 12, status: "active", onlineMinutesAgo: 4, tunnelTimeHours: 176.8, peakDeviceCount: 6 },
  { name: "Min — Monthly 200GB", usedGb: 9.4, limitGb: 200, endInDays: 6, status: "active", onlineMinutesAgo: null, tunnelTimeHours: 2.4, peakDeviceCount: 1 },
  { name: "Phyo — Monthly 200GB", usedGb: 200, limitGb: 200, endInDays: 8, status: "limit_exceeded", onlineMinutesAgo: null, tunnelTimeHours: 44.1, peakDeviceCount: 2 },
  { name: "Wai — Half-yearly 2TB", usedGb: 731.2, limitGb: 2000, endInDays: 121, status: "active", onlineMinutesAgo: 1, tunnelTimeHours: 51.7, peakDeviceCount: 3 },
  { name: "Kyaw — Monthly 200GB", usedGb: 5.1, limitGb: 200, endInDays: 30, status: "disabled", onlineMinutesAgo: null, tunnelTimeHours: 1.1, peakDeviceCount: 1 },
]

let nextId = 1

function keyFromSeed(seed: Seed): { key: Key; metrics: KeyMetrics } {
  const outlineKeyId = String(nextId++)
  const id = `mockkey-${outlineKeyId}`
  const usedBytes = Math.round(seed.usedGb * GB)
  const limitBytes = seed.limitGb === null ? null : Math.round(seed.limitGb * GB)

  return {
    key: {
      id,
      serverId: MOCK_SERVER_ID,
      outlineKeyId,
      name: seed.name,
      accessUrl: `ss://Y2hhY2hhMjA6bW9jaw@49.12.88.4:41627/?outline=1#${encodeURIComponent(seed.name)}`,
      dynamicAccessUrl: `ssconf://vpn.example.com/api/v1/dkey/mock-${outlineKeyId}#${encodeURIComponent(seed.name)}`,
      port: 41627,
      method: "chacha20-ietf-poly1305",
      usedBytes,
      customLimitBytes: limitBytes,
      endDate: seed.endInDays === null ? null : daysFromNow(seed.endInDays),
      enabled: seed.status !== "disabled",
      status: seed.status,
      createdAt: daysFromNow(-90),
      updatedAt: now().toISOString(),
      daysLeft: seed.endInDays,
      remainingBytes: limitBytes === null ? null : Math.max(0, limitBytes - usedBytes),
      // The preview fixture has no users behind it, so its keys are unassigned
      // — the same state a key adopted from an Outline server arrives in.
      userId: null,
    },
    metrics: {
      bytesTransferred: usedBytes,
      tunnelTimeHours: seed.tunnelTimeHours,
      lastTrafficSeen:
        seed.onlineMinutesAgo === null ? null : minutesAgo(seed.onlineMinutesAgo),
      peakDeviceCount: seed.peakDeviceCount,
      isOnline: seed.onlineMinutesAgo !== null && seed.onlineMinutesAgo <= 5,
    },
  }
}

const seeded = SEEDS.map(keyFromSeed)
const store = {
  keys: seeded.map((s) => s.key),
  keyMetrics: Object.fromEntries(
    seeded.map((s) => [s.key.outlineKeyId, s.metrics]),
  ) as Record<string, KeyMetrics>,
}

/**
 * Mirrors the backend's accessKeyHostname: the host baked into the first key's
 * ss:// link, and — like the backend — empty when there is no key to read one
 * off, which is the case the edit dialog auto-binds the server's own domain for.
 */
function mockAccessKeyHostname(): string {
  const match = store.keys[0]?.accessUrl.match(/@([^:/]+)/)
  return match?.[1] ?? ""
}

/** Mimics a round trip so loading states are visible while reviewing. */
const latency = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 300))

export function mockServerDetail(): Promise<ServerDetail> {
  return latency<ServerDetail>({
    server: {
      id: MOCK_SERVER_ID,
      name: "Frankfurt-01",
      apiUrl: "https://49.12.88.4:41627/aBc9xQ",
      certSha256: "MOCK",
      costUsdPerMonth: 12,
      lastSyncedAt: minutesAgo(1),
      lastSyncError: null,
      createdAt: daysFromNow(-120),
      updatedAt: now().toISOString(),
      maxKeys: null,
      defaultLimitBytes: null,
    },
    // Bare host, as the backend's server.Hostname() returns it — not the full
    // apiUrl, which is what the edit dialog's auto-bind fallback reads.
    hostname: "49.12.88.4",
    accessKeyHostname: mockAccessKeyHostname(),
    health: "healthy",
    metrics: {
      window: "30d",
      totalBytes: 4.0e12,
      currentBandwidthBps: 18_400,
      peakBandwidthBps: 2.14e8,
      peakBandwidthAt: minutesAgo(320),
      tunnelTimeHours: 1042.6,
      peakDevicesTotal: store.keys.length * 2,
      onlineKeys: Object.values(store.keyMetrics).filter((m) => m.isOnline).length,
      ases: [
        { asn: 45558, asOrg: "Myanma Posts and Telecommunications", countryCode: "MM", bytesTransferred: 1.68e12, tunnelTimeHours: 437.9, sharePct: 42 },
        { asn: 136255, asOrg: "Telecom International Myanmar (ATOM)", countryCode: "MM", bytesTransferred: 1.08e12, tunnelTimeHours: 281.5, sharePct: 27 },
        { asn: 133385, asOrg: "Ooredoo Myanmar", countryCode: "MM", bytesTransferred: 7.6e11, tunnelTimeHours: 198.1, sharePct: 19 },
        { asn: 138170, asOrg: "Mytel (Telecom International Myanmar)", countryCode: "MM", bytesTransferred: 4.8e11, tunnelTimeHours: 125.1, sharePct: 12 },
      ],
    },
    keys: store.keys,
    keyMetrics: store.keyMetrics,
    dailySeries: mockDailySeries(4.0e12 / 30),
  })
}

/** Design-fixture counterpart to GET /keys/:id/daily. */
export function mockKeyDaily(keyId: string): Promise<KeyUsageSeries> {
  const key = store.keys.find((k) => k.id === keyId)
  if (!key) return latency({ granularity: "day", series: [] })
  // The seed keys are all ~90 days old, so their lifetime usage spread over
  // that span is a reasonable stand-in for a recent daily average. None of
  // the fixture keys are under a day old, so the mock never exercises the
  // hourly granularity — that only ever comes from a live server.
  return latency({ granularity: "day", series: mockDailySeries(key.usedBytes / 90) })
}

export function mockCreateKey(
  name: string,
  addGb: number = MIN_PLAN_GB,
  addDays: number = MIN_PLAN_DAYS,
): Promise<Key> {
  const { key, metrics } = keyFromSeed({
    name,
    usedGb: 0,
    limitGb: addGb,
    endInDays: addDays,
    status: "active",
    onlineMinutesAgo: null,
    tunnelTimeHours: 0,
    peakDeviceCount: 0,
  })
  store.keys = [key, ...store.keys]
  store.keyMetrics[key.outlineKeyId] = metrics
  return latency(key)
}

export function mockRenameKey(keyId: string, name: string): Promise<null> {
  store.keys = store.keys.map((key) => (key.id === keyId ? { ...key, name } : key))
  return latency(null)
}

/**
 * The absolute counterpart to mockExtendKey: writes the limit and expiry as
 * given, ignoring usage, which is how a key inherited from an existing server
 * is put onto round figures. A limit at or below current usage leaves the key
 * exhausted, exactly as the backend's reconciler would.
 */
export function mockSetKeyPlan(
  keyId: string,
  limitGb: number,
  endDateInput: string,
  name?: string,
): Promise<null> {
  // The date input is a plain day; the key works through the end of it.
  const end = new Date(`${endDateInput}T23:59:59`)
  store.keys = store.keys.map((key) => {
    if (key.id !== keyId) return key
    const customLimitBytes = Math.round(limitGb * GB)
    const exhausted = key.usedBytes >= customLimitBytes
    const expired = end.getTime() < Date.now()
    return {
      ...key,
      name: name ?? key.name,
      customLimitBytes,
      endDate: end.toISOString(),
      daysLeft: Math.ceil((end.getTime() - Date.now()) / 86_400_000),
      remainingBytes: Math.max(0, customLimitBytes - key.usedBytes),
      status: expired ? "expired" : exhausted ? "limit_exceeded" : "active",
      enabled: !expired && !exhausted,
    }
  })
  return latency(null)
}

/**
 * Design-fixture counterpart to PATCH /servers/:id/config: a new access-key
 * hostname rewrites every key's static link's host.
 */
export function mockUpdateServerConfig(hostnameForAccessKeys?: string): Promise<null> {
  if (hostnameForAccessKeys) {
    store.keys = store.keys.map((key) => ({
      ...key,
      accessUrl: key.accessUrl.replace(/@[^:/]+/, `@${hostnameForAccessKeys}`),
    }))
  }
  return latency(null)
}

export function mockDeleteKey(keyId: string): Promise<null> {
  const removed = store.keys.find((k) => k.id === keyId)
  store.keys = store.keys.filter((k) => k.id !== keyId)
  if (removed) delete store.keyMetrics[removed.outlineKeyId]
  return latency(null)
}

export function mockExtendKey(
  keyId: string,
  addGb: number = MIN_PLAN_GB,
  addDays: number = MIN_PLAN_DAYS,
): Promise<null> {
  store.keys = store.keys.map((key) => {
    if (key.id !== keyId) return key
    // Same rule as the backend's models.RenewalTarget: the added data is
    // headroom on top of what is already used, and days extend from whichever
    // is later, today or the current end date. Extending is therefore also how
    // an expired key (switched off, Outline limit forced to zero) comes back.
    const customLimitBytes = key.usedBytes + Math.round(addGb * GB)
    const daysLeft = Math.max(key.daysLeft ?? 0, 0) + addDays
    return {
      ...key,
      customLimitBytes,
      daysLeft,
      endDate: daysFromNow(daysLeft),
      remainingBytes: Math.max(0, customLimitBytes - key.usedBytes),
      status: "active",
      enabled: true,
    }
  })
  return latency(null)
}
