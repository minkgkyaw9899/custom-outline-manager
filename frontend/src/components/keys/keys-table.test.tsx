import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"

import { KeysTable } from "./keys-table"
import { BYTES_PER_GB } from "@/lib/format"
import type { Key, KeyMetrics } from "@/lib/types"

function makeKey(index: number, overrides: Partial<Key> = {}): Key {
  const usedBytes = 10 * BYTES_PER_GB
  const customLimitBytes = 200 * BYTES_PER_GB
  return {
    id: `key-${index}`,
    serverId: "server-1",
    outlineKeyId: String(index),
    name: `Holder ${index}`,
    accessUrl: `ss://example#key-${index}`,
    dynamicAccessUrl: "",
    port: 26574,
    method: "chacha20-ietf-poly1305",
    usedBytes,
    customLimitBytes,
    endDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    enabled: true,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    daysLeft: 30,
    remainingBytes: customLimitBytes - usedBytes,
    userId: null,
    ...overrides,
  }
}

const metrics: Record<string, KeyMetrics> = {}

// Rows navigate to the key detail screen, so the table needs a router as well
// as a query client to mount.
async function renderTable(keys: Key[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <KeysTable
        serverId="server-1"
        keys={keys}
        keyMetrics={metrics}
        onlineKeys={1}
        windowLabel="30 days"
        defaultLimitBytes={null}
      />
    ),
  })
  const keyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/keys/$keyId",
    component: () => <div>key detail</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, keyRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  // The router mounts its route asynchronously; without this every query below
  // would run against an empty document.
  await screen.findByText(/^Access keys \(/)
  return result
}

/** Names visible in the table body, i.e. the current page. */
function visibleNames(): string[] {
  const rows = screen.getAllByRole("row").slice(1)
  return rows
    .map((row) => within(row).queryByText(/^Holder \d+$/)?.textContent ?? "")
    .filter(Boolean)
}

describe("keys table", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => makeKey(i + 1))

  it("pages at ten rows and reports the range", async () => {
    await renderTable(twelve)
    expect(visibleNames()).toHaveLength(10)
    expect(screen.getByText("1–10 of 12 keys")).toBeTruthy()
    expect(screen.getByText("Page 1 of 2")).toBeTruthy()
  })

  it("moves to the next page and back", async () => {
    await renderTable(twelve)
    fireEvent.click(screen.getByLabelText("Next page"))
    expect(visibleNames()).toEqual(["Holder 11", "Holder 12"])
    expect(screen.getByText("11–12 of 12 keys")).toBeTruthy()

    fireEvent.click(screen.getByLabelText("Previous page"))
    expect(screen.getByText("1–10 of 12 keys")).toBeTruthy()
  })

  // Sorting re-renders the table; the filter state must keep its identity or
  // the table auto-resets to page 1 on every interaction.
  it("stays on the page it was paged to", async () => {
    await renderTable(twelve)
    fireEvent.click(screen.getByLabelText("Next page"))
    expect(screen.getByText("Page 2 of 2")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Last page"))
    expect(screen.getByText("Page 2 of 2")).toBeTruthy()
  })

  // Deleting a key is irreversible on the Outline server, so the icon must not
  // act on its own.
  it("asks for confirmation before deleting a key", async () => {
    await renderTable([makeKey(1)])
    expect(screen.queryByText("Delete Holder 1?")).toBeNull()

    fireEvent.click(screen.getByLabelText("Delete Holder 1"))
    expect(screen.getByText("Delete Holder 1?")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete key" })).toBeTruthy()
  })

  it("offers copy, edit and delete on every row", async () => {
    await renderTable([makeKey(1)])
    expect(screen.getByLabelText("Edit Holder 1")).toBeTruthy()
    expect(screen.getByLabelText("Delete Holder 1")).toBeTruthy()
    expect(screen.getByText("Copy")).toBeTruthy()
  })

  it("shows an empty state with a way out when the server has no keys", async () => {
    await renderTable([])
    expect(screen.getByText("No access keys yet")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: /New key/i }).length).toBeGreaterThan(0)
  })

  // Every row is a way into the key's own screen — by click anywhere on it, and
  // by the name for anyone on a keyboard.
  it("opens the key detail screen from a row", async () => {
    await renderTable([makeKey(1)])
    const link = screen.getByRole("link", { name: /Holder 1/ })
    expect(link.getAttribute("href")).toBe("/admin/keys/key-1")

    fireEvent.click(screen.getByText("Holder 1").closest("tr")!)
    expect(await screen.findByText("key detail")).toBeTruthy()
  })

  // The usage cell reads as one fraction: used and limit share a unit.
  it("shows usage against the cap in a single unit", async () => {
    await renderTable([makeKey(1)])
    expect(screen.getByText("10/200 GB")).toBeTruthy()
  })

  // Columns dropped from the design: the detail screen carries them instead.
  it("drops the remaining, tunnel time and last active columns", async () => {
    await renderTable([makeKey(1)])
    expect(screen.queryByText("Remaining")).toBeNull()
    expect(screen.queryByText("Tunnel time")).toBeNull()
    expect(screen.queryByText("Last active")).toBeNull()
    // The Outline key id no longer shadows the holder's name.
    expect(screen.queryByText("key_1")).toBeNull()
  })

  // An unmetered key has no bar to draw: a full track would read as "no quota
  // left" rather than "no quota set".
  it("labels a key with no data limit instead of drawing a full bar", async () => {
    await renderTable([makeKey(1, { customLimitBytes: null, remainingBytes: null })])
    expect(screen.getByText("No limit")).toBeTruthy()
  })
})

describe("keys table status filter", () => {
  const mixed = [
    makeKey(1),
    makeKey(2, { status: "limit_exceeded" }),
    makeKey(3, { status: "expired" }),
  ]

  it("narrows the table to one status", async () => {
    await renderTable(mixed)
    expect(visibleNames()).toHaveLength(3)

    fireEvent.click(screen.getByLabelText("Filter by status"))
    const option = await screen.findByRole("option", { name: "Expired" })
    // Base UI selects commit on pointer up, not on a bare click event.
    fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 })
    fireEvent.pointerUp(option, { pointerType: "mouse", button: 0 })
    fireEvent.click(option)

    expect(visibleNames()).toEqual(["Holder 3"])
    expect(screen.getByText("1–1 of 1 key")).toBeTruthy()
  })
})

describe("edit key dialog", () => {
  // Extending grants a whole plan period, and the new ceiling is measured from
  // current usage — 10 GB used + 200 GB added = a 210 GB limit.
  it("previews the new limit as usage plus the added data", async () => {
    await renderTable([makeKey(1)])
    fireEvent.click(screen.getByLabelText("Edit Holder 1"))

    fireEvent.click(await screen.findByRole("button", { name: "Extend" }))
    expect(await screen.findByText(/New limit 210.0 GB/)).toBeTruthy()
  })

  // An expired key is already switched off on the Outline server, so the only
  // reason to open it is to bring it back.
  it("opens on the extension for an expired key", async () => {
    await renderTable([makeKey(1, { status: "expired", daysLeft: -3 })])
    fireEvent.click(screen.getByLabelText("Edit Holder 1"))
    expect(await screen.findByText(/New limit 210.0 GB/)).toBeTruthy()
  })

  it("refuses an extension below one plan period", async () => {
    await renderTable([makeKey(1, { status: "expired", daysLeft: -3 })])
    fireEvent.click(screen.getByLabelText("Edit Holder 1"))

    const gb = await screen.findByLabelText("Add data")
    fireEvent.change(gb, { target: { value: "50" } })
    expect(screen.getByText("A plan period is at least 200 GB.")).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" })
        .disabled,
    ).toBe(true)
  })

  // The point of "Set exact" is writing a round figure over one a renewal
  // computed, e.g. trimming 206.9 GB back to 200 GB, so no plan floor applies
  // and usage is not added on.
  it("sets an absolute limit, ignoring usage and the plan floor", async () => {
    await renderTable([
      makeKey(1, {
        usedBytes: 6.9 * BYTES_PER_GB,
        customLimitBytes: 206.9 * BYTES_PER_GB,
      }),
    ])
    fireEvent.click(screen.getByLabelText("Edit Holder 1"))
    fireEvent.click(await screen.findByRole("button", { name: "Set exact" }))

    const total = await screen.findByLabelText<HTMLInputElement>("Total data limit")
    expect(total.value).toBe("206.9")

    fireEvent.change(total, { target: { value: "200" } })
    expect(screen.getByText(/193.1 GB left/)).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" })
        .disabled,
    ).toBe(false)
  })

  // Allowed, but it takes the key offline the moment it is saved, so say so.
  it("warns when the new limit is below what is already used", async () => {
    await renderTable([makeKey(1, { usedBytes: 150 * BYTES_PER_GB })])
    fireEvent.click(screen.getByLabelText("Edit Holder 1"))
    fireEvent.click(await screen.findByRole("button", { name: "Set exact" }))

    fireEvent.change(await screen.findByLabelText("Total data limit"), {
      target: { value: "100" },
    })
    expect(screen.getByText(/switches the key off straight away/)).toBeTruthy()
  })
})

describe("new key dialog", () => {
  it("defaults to one plan period and blocks anything smaller", async () => {
    await renderTable([makeKey(1)])
    fireEvent.click(screen.getAllByRole("button", { name: /New key/i })[0])

    const limit = await screen.findByLabelText<HTMLInputElement>("Data limit")
    const days = screen.getByLabelText<HTMLInputElement>("Valid for")
    expect(limit.value).toBe("200")
    expect(days.value).toBe("30")

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Yamin" },
    })
    fireEvent.change(days, { target: { value: "7" } })
    expect(screen.getByText("A key runs for 30 days or more.")).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Create key" })
        .disabled,
    ).toBe(true)
  })
})
