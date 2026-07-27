// Canonical mock server registry. Both the Overview and the Servers page read
// from this list so the two screens agree on how many servers exist and what
// state they are in. The shapes here are the draft contract for the endpoints
// that will replace them — see docs/DESIGN_HANDOFF.md.

export type ServerHealthStatus = "healthy" | "degraded" | "offline"

/** Myanmar mobile carrier a key's traffic is attributed to. */
export interface OperatorShare {
  name: string
  sharePct: number
}

export interface MockServer {
  id: string
  name: string
  status: ServerHealthStatus
  /** Human region label shown in the card subtitle, e.g. "EU Central". */
  region: string
  ipAddress: string
  costUsdPerMonth: number
  /** Current load as a percentage of provisioned capacity (Fleet health). */
  loadPct: number
  activeKeys: number
  inboundBytes: number
  outboundBytes: number
  /** Highest-share carriers first; shares sum to 100. */
  topOperators: OperatorShare[]
  /** Total transferred over PERIOD_LABEL, i.e. inbound + outbound. */
  periodTotalBytes: number
  /** 24 daily buckets over PERIOD_LABEL, relative units for the sparkline. */
  spark: number[]
}

/** Static USD→MMK rate used for the Revenue page and the add-server dialog. */
export const MMK_PER_USD = 4500

/** The window every server card summarises. */
export const PERIOD_LABEL = "01 Jul – 25 Jul 2026"

/** Stable colour per carrier so shares read the same across every screen. */
export const OPERATOR_COLOR: Record<string, string> = {
  MPT: "var(--chart-1)",
  ATOM: "var(--chart-2)",
  Mytel: "var(--chart-3)",
  Ooredoo: "var(--chart-5)",
}

const TB = 1e12

export const MOCK_SERVERS: MockServer[] = [
  {
    id: "frankfurt-01",
    name: "Frankfurt-01",
    status: "healthy",
    region: "EU Central",
    ipAddress: "49.12.88.4",
    costUsdPerMonth: 12,
    loadPct: 41,
    activeKeys: 86,
    inboundBytes: 1.4 * TB,
    outboundBytes: 2.6 * TB,
    topOperators: [
      { name: "MPT", sharePct: 42 },
      { name: "ATOM", sharePct: 27 },
      { name: "Ooredoo", sharePct: 19 },
      { name: "Mytel", sharePct: 12 },
    ],
    periodTotalBytes: 4.0 * TB,
    spark: [46, 38, 52, 44, 60, 41, 35, 55, 48, 62, 40, 50, 43, 58, 36, 47, 53, 39, 45, 57, 42, 49, 88, 71],
  },
  {
    id: "singapore-02",
    name: "Singapore-02",
    status: "healthy",
    region: "APAC",
    ipAddress: "128.199.44.19",
    costUsdPerMonth: 6,
    loadPct: 33,
    activeKeys: 64,
    inboundBytes: 0.9 * TB,
    outboundBytes: 1.7 * TB,
    topOperators: [
      { name: "ATOM", sharePct: 38 },
      { name: "MPT", sharePct: 31 },
      { name: "Mytel", sharePct: 21 },
      { name: "Ooredoo", sharePct: 10 },
    ],
    periodTotalBytes: 2.6 * TB,
    spark: [34, 42, 38, 50, 45, 36, 54, 40, 47, 33, 58, 44, 39, 52, 46, 37, 49, 55, 41, 48, 35, 43, 72, 92],
  },
  {
    id: "new-york-03",
    name: "New York-03",
    status: "degraded",
    region: "US East",
    ipAddress: "165.22.10.77",
    costUsdPerMonth: 6,
    loadPct: 78,
    activeKeys: 52,
    inboundBytes: 0.7 * TB,
    outboundBytes: 1.4 * TB,
    topOperators: [
      { name: "MPT", sharePct: 46 },
      { name: "Ooredoo", sharePct: 24 },
      { name: "ATOM", sharePct: 18 },
      { name: "Mytel", sharePct: 12 },
    ],
    periodTotalBytes: 2.1 * TB,
    spark: [40, 62, 44, 36, 58, 47, 33, 55, 42, 51, 38, 60, 45, 34, 53, 48, 39, 56, 43, 50, 37, 46, 90, 78],
  },
  {
    id: "tokyo-04",
    name: "Tokyo-04",
    status: "offline",
    region: "APAC",
    ipAddress: "45.76.200.31",
    costUsdPerMonth: 6,
    loadPct: 0,
    activeKeys: 46,
    inboundBytes: 0.4 * TB,
    outboundBytes: 0.9 * TB,
    topOperators: [
      { name: "Mytel", sharePct: 35 },
      { name: "MPT", sharePct: 33 },
      { name: "ATOM", sharePct: 20 },
      { name: "Ooredoo", sharePct: 12 },
    ],
    periodTotalBytes: 1.3 * TB,
    spark: [58, 41, 47, 39, 53, 45, 36, 50, 43, 56, 38, 48, 34, 52, 44, 40, 55, 37, 49, 42, 46, 35, 86, 64],
  },
  {
    id: "sydney-05",
    name: "Sydney-05",
    status: "healthy",
    region: "APAC",
    ipAddress: "170.64.135.88",
    costUsdPerMonth: 6,
    loadPct: 29,
    activeKeys: 38,
    inboundBytes: 0.3 * TB,
    outboundBytes: 0.7 * TB,
    topOperators: [
      { name: "ATOM", sharePct: 40 },
      { name: "Mytel", sharePct: 28 },
      { name: "MPT", sharePct: 22 },
      { name: "Ooredoo", sharePct: 10 },
    ],
    periodTotalBytes: 1.0 * TB,
    spark: [32, 45, 38, 51, 36, 48, 41, 55, 34, 46, 39, 52, 43, 37, 50, 44, 35, 49, 40, 53, 42, 47, 68, 84],
  },
  {
    id: "toronto-06",
    name: "Toronto-06",
    status: "healthy",
    region: "US East",
    ipAddress: "159.203.77.12",
    costUsdPerMonth: 12,
    loadPct: 47,
    activeKeys: 71,
    inboundBytes: 1.1 * TB,
    outboundBytes: 2.0 * TB,
    topOperators: [
      { name: "MPT", sharePct: 37 },
      { name: "ATOM", sharePct: 29 },
      { name: "Mytel", sharePct: 20 },
      { name: "Ooredoo", sharePct: 14 },
    ],
    periodTotalBytes: 3.1 * TB,
    spark: [44, 51, 39, 57, 42, 48, 35, 54, 46, 38, 59, 43, 50, 36, 52, 45, 40, 56, 41, 47, 34, 49, 82, 74],
  },
]

export const SERVER_STATUS_LABEL: Record<ServerHealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  offline: "Offline",
}

export function countByStatus(status: ServerHealthStatus): number {
  return MOCK_SERVERS.filter((s) => s.status === status).length
}
