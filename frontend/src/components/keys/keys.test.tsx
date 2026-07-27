import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { KeyConnectionStatus, OnlineKeysBadge } from "./key-connection-status"

describe("key connection status", () => {
  it("labels a connected key so the dot is not colour-only", () => {
    render(<KeyConnectionStatus name="Aung Lin 2" outlineKeyId="1" isOnline />)
    expect(screen.getByText("Aung Lin 2")).toBeTruthy()
    expect(screen.getByText("Connected now")).toBeTruthy()
  })

  it("labels an idle key rather than saying nothing", () => {
    render(
      <KeyConnectionStatus name="Zaw Lin Shein" outlineKeyId="2" isOnline={false} />,
    )
    expect(screen.getByText("Not connected")).toBeTruthy()
    expect(screen.queryByText("Connected now")).toBeNull()
  })

  // Keys created outside this dashboard can have no name; an empty cell would
  // leave the row unidentifiable.
  it("falls back to the Outline key id when a key is unnamed", () => {
    render(<KeyConnectionStatus name="  " outlineKeyId="3" isOnline={false} />)
    expect(screen.getByText("Key 3")).toBeTruthy()
  })
})

describe("online keys badge", () => {
  it("reports the live count", () => {
    render(<OnlineKeysBadge onlineKeys={3} />)
    expect(screen.getByText("3 connected now")).toBeTruthy()
  })

  it("says nothing when metrics are unavailable, rather than claiming zero", () => {
    const { container } = render(<OnlineKeysBadge onlineKeys={null} />)
    expect(container.textContent).toBe("")
  })
})
