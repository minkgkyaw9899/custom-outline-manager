import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { BandwidthConsumptionCard } from "./bandwidth-consumption-card"
import { CompareServersCard } from "./compare-servers-card"
import { FleetHealthCard } from "./fleet-health-card"
import { KeysAttentionCard } from "./keys-attention-card"
import type { Key, ServerWithUsage } from "@/lib/types"

function mockServer(overrides: Partial<ServerWithUsage> = {}): ServerWithUsage {
  return {
    id: "server-1",
    name: "Frankfurt-01",
    apiUrl: "https://example.com",
    certSha256: "abc",
    costUsdPerMonth: null,
    lastSyncedAt: null,
    lastSyncError: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    maxKeys: null,
    defaultLimitBytes: null,
    defaultPriceMmk: null,
    bandwidthLimitBytes: null,
    bandwidthDisabledAt: null,
    hostname: "frankfurt.example.com",
    health: "healthy",
    keyCount: 10,
    activeKeys: 8,
    totalUsedBytes: 0,
    monthlyRevenueMmk: 0,
    unpricedActiveKeys: 0,
    freeActiveKeys: 0,
    metrics: null,
    dailySeries: [
      { date: "2026-01-01", bytes: 5_000_000_000 },
      { date: "2026-01-02", bytes: 7_000_000_000 },
    ],
    revenueDailySeries: [],
    bandwidthUsedBytesThisMonth: 0,
    ...overrides,
  }
}

function mockKey(overrides: Partial<Key> = {}): Key {
  return {
    id: "key-1",
    serverId: "server-1",
    outlineKeyId: "1",
    name: "Ko Ko",
    accessUrl: "ss://example",
    dynamicAccessUrl: "",
    port: null,
    method: null,
    usedBytes: 2_900_000_000,
    customLimitBytes: 50_000_000_000,
    endDate: null,
    priceMmk: null,
    enabled: true,
    status: "expired",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    daysLeft: -1,
    remainingBytes: null,
    serverName: "Frankfurt-01",
    userId: null,
    ...overrides,
  }
}

describe("dashboard overview cards", () => {
  it("renders the bandwidth consumption card for the selected server", () => {
    const servers = [mockServer()]
    render(<BandwidthConsumptionCard servers={servers} />)
    expect(screen.getByText("Bandwidth consumption")).toBeTruthy()
    expect(screen.getByText(/Per-server bandwidth · Frankfurt-01 · daily/)).toBeTruthy()
  })

  it("shows an empty state when a server has no sync history yet", () => {
    const servers = [mockServer({ dailySeries: [] })]
    render(<BandwidthConsumptionCard servers={servers} />)
    expect(
      screen.getByText(/No traffic history yet/),
    ).toBeTruthy()
  })

  it("renders the compare card with both server series", () => {
    const servers = [
      mockServer({ id: "server-1", name: "Frankfurt-01" }),
      mockServer({ id: "server-2", name: "Singapore-02" }),
    ]
    render(<CompareServersCard servers={servers} />)
    expect(screen.getByText("Compare server bandwidth")).toBeTruthy()
    expect(
      screen.getByText(/Frankfurt-01 vs Singapore-02 · total bandwidth per day/),
    ).toBeTruthy()
  })

  it("lists keys needing attention, filtering out healthy keys", () => {
    const keys = [
      mockKey({ id: "key-1", name: "Ko Ko", status: "expired", daysLeft: -1 }),
      mockKey({ id: "key-2", name: "Zaw", status: "limit_exceeded", daysLeft: null }),
      mockKey({
        id: "key-3",
        name: "Nyein",
        status: "active",
        daysLeft: 30,
        customLimitBytes: null,
      }),
    ]
    render(<KeysAttentionCard keys={keys} />)
    expect(screen.getByText("Keys needing attention")).toBeTruthy()
    expect(screen.getByText("Ko Ko")).toBeTruthy()
    expect(screen.getByText("Zaw")).toBeTruthy()
    expect(screen.queryByText("Nyein")).toBeNull()
    expect(screen.getByText("Expired")).toBeTruthy()
    expect(screen.getByText("Limit")).toBeTruthy()
  })

  it("renders fleet health with per-server status and key counts", () => {
    const servers = [
      mockServer({ id: "server-1", name: "Frankfurt-01", health: "degraded", activeKeys: 8, keyCount: 10 }),
    ]
    render(<FleetHealthCard servers={servers} />)
    expect(screen.getByText("Fleet health")).toBeTruthy()
    expect(screen.getByText("Frankfurt-01")).toBeTruthy()
    expect(screen.getByText("8 / 10 keys active")).toBeTruthy()
  })
})
