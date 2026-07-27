import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { BandwidthConsumptionCard } from "./bandwidth-consumption-card"
import { CompareServersCard } from "./compare-servers-card"
import { FleetHealthCard } from "./fleet-health-card"
import { KeysAttentionCard } from "./keys-attention-card"
import { StatCard } from "./stat-card"
import { OVERVIEW_STATS } from "@/lib/mock-dashboard"

describe("dashboard overview cards", () => {
  it("renders a stat card with value, badge and note", () => {
    const { keys } = OVERVIEW_STATS
    render(
      <StatCard
        label="Total active keys"
        badge={`+${keys.deltaThisWeek} this week`}
        value={String(keys.total)}
        valueSuffix="keys"
        note={`${keys.expiringIn7Days} expiring in 7 days`}
        sparkline={keys.spark}
      />,
    )
    expect(screen.getByText("Total active keys")).toBeTruthy()
    expect(screen.getByText("248")).toBeTruthy()
    expect(screen.getByText("+12 this week")).toBeTruthy()
    expect(screen.getByText("31 expiring in 7 days")).toBeTruthy()
  })

  it("renders the bandwidth consumption card with its default selections", () => {
    render(<BandwidthConsumptionCard />)
    expect(screen.getByText("Bandwidth consumption")).toBeTruthy()
    expect(screen.getByText(/Per-server bandwidth · New York-03 · daily/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Daily" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Monthly" })).toBeTruthy()
  })

  it("switches the bandwidth card between daily and monthly", () => {
    render(<BandwidthConsumptionCard />)
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }))
    expect(screen.getByText(/Per-server bandwidth · New York-03 · monthly/)).toBeTruthy()
  })

  it("renders the compare card with both server series", () => {
    render(<CompareServersCard />)
    expect(screen.getByText("Compare server bandwidth")).toBeTruthy()
    expect(
      screen.getByText(/Singapore-02 vs New York-03 · total bandwidth per period/),
    ).toBeTruthy()
  })

  it("lists keys needing attention with usage and status", () => {
    render(<KeysAttentionCard />)
    expect(screen.getByText("Keys needing attention")).toBeTruthy()
    expect(screen.getByText("Ko Ko — Trial 50GB")).toBeTruthy()
    expect(screen.getByText("Frankfurt-01 · Mytel")).toBeTruthy()
    expect(screen.getByText("2.9 GB")).toBeTruthy()
    expect(screen.getByText("Expired")).toBeTruthy()
  })

  it("renders fleet health with per-server load and latency", () => {
    render(<FleetHealthCard />)
    expect(screen.getByText("Fleet health")).toBeTruthy()
    expect(screen.getByText("Tokyo-04")).toBeTruthy()
    expect(screen.getByText("78%")).toBeTruthy()
    expect(screen.getByText("38 ms")).toBeTruthy()
  })
})
