// Mock data for the dashboard overview, matching the Invisigate VPN design
// (docs/DESIGN_HANDOFF.md). The shapes exported here are the draft contract
// for the backend endpoints that will replace this module — keep them in sync
// with the handoff doc when they change.

import { BYTES_PER_GB } from "./format"
import { MOCK_SERVERS, countByStatus } from "./mock-servers"
import type { ServerHealthStatus } from "./mock-servers"

export type { ServerHealthStatus }

export interface OverviewServer {
  id: string
  name: string
  status: ServerHealthStatus
  /** Current load as a percentage of the server's provisioned capacity. */
  loadPct: number
}

/** Fleet health lists every server, so it derives straight from the registry. */
export const OVERVIEW_SERVERS: OverviewServer[] = MOCK_SERVERS.map(
  ({ id, name, status, loadPct }) => ({ id, name, status, loadPct }),
)

export const AVG_LATENCY_MS = 38
export const LAST_SYNC_SECONDS_AGO = 42

export interface OverviewStats {
  keys: {
    total: number
    deltaThisWeek: number
    expiringIn7Days: number
    spark: number[]
  }
  servers: {
    connected: number
    total: number
    degraded: number
    note: string
    spark: number[]
  }
  bandwidth: {
    monthlyBytes: number
    deltaPct: number
    inBytes: number
    outBytes: number
    spark: number[]
  }
}

export const OVERVIEW_STATS: OverviewStats = {
  keys: {
    total: 248,
    deltaThisWeek: 12,
    expiringIn7Days: 31,
    spark: [38, 42, 30, 44, 52, 40, 36, 55, 48, 41, 46, 43, 58, 62],
  },
  // Counts derive from the registry so the Overview and Servers pages never
  // disagree about how many servers exist.
  servers: {
    connected: MOCK_SERVERS.length - countByStatus("offline"),
    total: MOCK_SERVERS.length,
    degraded: countByStatus("degraded"),
    note: "Tokyo-04 unreachable 4m",
    spark: [40, 44, 48, 38, 52, 46, 42, 50, 47, 44, 40, 39, 60, 54],
  },
  bandwidth: {
    monthlyBytes: 11.4e12,
    deltaPct: 18.2,
    inBytes: 4.1e12,
    outBytes: 7.3e12,
    spark: [35, 40, 38, 50, 42, 46, 52, 44, 48, 43, 47, 45, 53, 64],
  },
}

export type AttentionStatus = "expiring" | "limit" | "expired"

export interface AttentionKey {
  id: string
  name: string
  plan: string
  serverName: string
  carrier: string
  usedBytes: number
  status: AttentionStatus
  statusLabel: string
}

export const ATTENTION_KEYS: AttentionKey[] = [
  {
    id: "key-1",
    name: "Ko Ko",
    plan: "Trial 50GB",
    serverName: "Frankfurt-01",
    carrier: "Mytel",
    usedBytes: 2.9 * BYTES_PER_GB,
    status: "expiring",
    statusLabel: "3 days",
  },
  {
    id: "key-2",
    name: "Zaw",
    plan: "Monthly 200GB",
    serverName: "Frankfurt-01",
    carrier: "MPT",
    usedBytes: 0,
    status: "limit",
    statusLabel: "Limit",
  },
  {
    id: "key-3",
    name: "Nyein",
    plan: "Monthly 100GB",
    serverName: "Frankfurt-01",
    carrier: "Ooredoo",
    usedBytes: 37.6 * BYTES_PER_GB,
    status: "expired",
    statusLabel: "Expired",
  },
  {
    id: "key-4",
    name: "Hla",
    plan: "Trial 20GB",
    serverName: "Singapore-02",
    carrier: "ATOM",
    usedBytes: 1.2 * BYTES_PER_GB,
    status: "limit",
    statusLabel: "Limit",
  },
]

export const DAY_LABELS = Array.from({ length: 31 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
)

export const MONTH_LABELS = [
  "Aug", "Sep", "Oct", "Nov", "Dec", "Jan",
  "Feb", "Mar", "Apr", "May", "Jun", "Jul",
]

// Smooth deterministic waves so charts look like real traffic and never
// change between renders. Each server gets its own phase/amplitude.
const SERIES_PARAMS: Record<
  string,
  { baseGb: number; ampGb: number; phase: number; wobbleGb: number }
> = {
  "frankfurt-01": { baseGb: 520, ampGb: 260, phase: 0.4, wobbleGb: 60 },
  "singapore-02": { baseGb: 640, ampGb: 300, phase: 2.1, wobbleGb: 80 },
  "new-york-03": { baseGb: 780, ampGb: 380, phase: 5.2, wobbleGb: 70 },
  "tokyo-04": { baseGb: 240, ampGb: 120, phase: 3.3, wobbleGb: 40 },
  "sydney-05": { baseGb: 400, ampGb: 190, phase: 1.2, wobbleGb: 50 },
  "toronto-06": { baseGb: 700, ampGb: 320, phase: 4.1, wobbleGb: 75 },
}

function wave(index: number, points: number, serverId: string): number {
  const p = SERIES_PARAMS[serverId] ?? SERIES_PARAMS["frankfurt-01"]
  const t = (index / points) * Math.PI * 2
  const gb =
    p.baseGb +
    p.ampGb * Math.sin(t * 2 + p.phase) +
    p.wobbleGb * Math.sin(t * 5 + p.phase * 3)
  return Math.max(20, Math.round(gb)) * BYTES_PER_GB
}

export function dailySeriesFor(serverId: string): number[] {
  return DAY_LABELS.map((_, i) => wave(i, DAY_LABELS.length, serverId))
}

export function monthlySeriesFor(serverId: string): number[] {
  return MONTH_LABELS.map(
    (_, i) => wave(i, MONTH_LABELS.length, serverId) * 28,
  )
}
