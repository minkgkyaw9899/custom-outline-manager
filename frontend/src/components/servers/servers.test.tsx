import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"

import { AddServerDialog } from "./add-server-dialog"
import { AsShareList } from "./as-share-list"
import { EditServerDialog } from "./edit-server-dialog"
import { ServerCard } from "./server-card"
import { Button } from "@/components/ui/button"
import type { ASUsage, ServerDetail, ServerWithUsage } from "@/lib/types"

// Shaped like a real Outline server metrics response (including a real,
// public ASN/org pair) so the card is pinned against the actual API shape
// rather than an invented one — but with a synthetic hostname/cert, not a
// real server's.
const frontiir: ASUsage = {
  asn: 58952,
  asOrg: "Frontiir Co., Ltd",
  countryCode: "MM",
  bytesTransferred: 6115628839,
  tunnelTimeHours: 9.1532,
  sharePct: 100,
}

function makeServer(overrides: Partial<ServerWithUsage> = {}): ServerWithUsage {
  return {
    id: "70cfad3a-b8d6-44f7-8543-5934de3d0f33",
    name: "LSD 1 Yamin",
    apiUrl: "https://vpn-test-1.example.com:26574/secret",
    certSha256: "f5d4b4e6",
    costUsdPerMonth: 7,
    lastSyncedAt: new Date().toISOString(),
    lastSyncError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    maxKeys: null,
    defaultLimitBytes: null,
    defaultPriceMmk: null,
    bandwidthLimitBytes: null,
    bandwidthDisabledAt: null,
    hostname: "vpn-test-1.example.com",
    health: "healthy",
    // 2 keys, both valid, but only 1 connected — the live shape of this server,
    // and the case that distinguishes "connected" from "valid".
    keyCount: 2,
    activeKeys: 2,
    totalUsedBytes: 6115628839,
    monthlyRevenueMmk: 0,
    unpricedActiveKeys: 0,
    freeActiveKeys: 0,
    metrics: {
      window: "30d",
      totalBytes: 6115628839,
      currentBandwidthBps: 34119,
      peakBandwidthBps: 8646047,
      peakBandwidthAt: new Date().toISOString(),
      tunnelTimeHours: 9.1532,
      ases: [frontiir],
      peakDevicesTotal: 2,
      onlineKeys: 1,
    },
    dailySeries: [],
    revenueDailySeries: [],
    bandwidthUsedBytesThisMonth: 0,
    bandwidthTrackingSince: null,
    bandwidthTrackingComplete: true,
    ...overrides,
  }
}

// ServerCard renders a router Link and runs mutations, so it needs both a
// router and a query client to mount.
function renderCard(server: ServerWithUsage) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <ServerCard server={server} />,
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/servers/$serverId",
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

/** The rendered value of one card Metric, read via its label. */
function metricValue(label: string): string | undefined {
  return screen.getByText(label).nextElementSibling?.textContent ?? undefined
}

describe("server card", () => {
  it("renders identity, health and cost from the API shape", async () => {
    renderCard(makeServer())
    expect(await screen.findByText("LSD 1 Yamin")).toBeTruthy()
    expect(screen.getByText("Healthy")).toBeTruthy()
    expect(screen.getByText("vpn-test-1.example.com · $7/mo")).toBeTruthy()
  })

  // Outline exposes no inbound/outbound split, so the two slots the design drew
  // as directional traffic show the live rate and the window total instead.
  it("shows current bandwidth as a rate and total bandwidth as a volume", async () => {
    renderCard(makeServer())
    expect(await screen.findByText("Current bandwidth")).toBeTruthy()
    expect(screen.getByText("34 kB/s")).toBeTruthy()
    expect(screen.getByText("Total bandwidth")).toBeTruthy()
    expect(screen.getByText("6.1 GB")).toBeTruthy()
    expect(screen.queryByText("Inbound")).toBeNull()
    expect(screen.queryByText("Outbound")).toBeNull()
  })

  // "Connected keys" is the live count, not the number of non-expired keys —
  // the fixture has 2 valid keys but only 1 connected.
  it("shows how many keys are connected right now, not how many are valid", async () => {
    renderCard(makeServer())
    await screen.findByText("Connected keys")
    // Read each value next to its own label: bare "1" also appears as the AS
    // count, and asserting on it loosely would pass for the wrong reason.
    expect(metricValue("Connected keys")).toBe("1")
    expect(metricValue("Total keys")).toBe("2")
    expect(screen.queryByText("Active keys")).toBeNull()
  })

  it("falls back to synced usage and dashes when live metrics are missing", async () => {
    renderCard(makeServer({ metrics: null, health: "degraded" }))
    expect(await screen.findByText("Degraded")).toBeTruthy()
    // Connected keys, peak devices, current bandwidth and tunnel time are all
    // live-only, so they have no fallback and read as dashes. A "0" there would
    // claim nobody is connected when we simply could not ask.
    expect(screen.getAllByText("—")).toHaveLength(4)
    // Key counts and the total still come from the last sync.
    expect(screen.getByText("6.1 GB")).toBeTruthy()
    expect(screen.getByText("Total keys")).toBeTruthy()
  })

  it("omits the cost segment when no cost is recorded", async () => {
    renderCard(makeServer({ costUsdPerMonth: null }))
    expect(await screen.findByText("vpn-test-1.example.com")).toBeTruthy()
  })

  it("shows key counts, peak devices, tunnel time and the AS count", async () => {
    renderCard(makeServer())
    expect(await screen.findByText("Total keys")).toBeTruthy()
    expect(screen.getByText("Connected keys")).toBeTruthy()
    expect(metricValue("Peak devices")).toBe("2")
    expect(screen.getByText("Tunnel time")).toBeTruthy()
    expect(screen.getByText("9.153 hours")).toBeTruthy()
    expect(screen.getByText("ASes")).toBeTruthy()
  })

  it("asks for confirmation before removing a server, and says what survives", async () => {
    renderCard(makeServer())
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove LSD 1 Yamin" })
    )

    expect(await screen.findByText("Remove LSD 1 Yamin?")).toBeTruthy()
    // Deleting our record must not imply tearing down the Outline server.
    expect(
      screen.getByText(/The Outline server itself keeps running/)
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Remove server" })).toBeTruthy()
  })
})

describe("add server dialog", () => {
  function openDialog() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <AddServerDialog>
          <Button>Add server</Button>
        </AddServerDialog>
      </QueryClientProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Add server" }))
  }

  // The Outline installer emits the fingerprint as a separate JSON field, not
  // embedded in the URL, so the field must take the whole blob — hence one
  // free-text field for the management key rather than a URL input.
  it("takes the whole management key in one field", () => {
    openDialog()
    expect(screen.getByText("Add Outline server")).toBeTruthy()
    expect(screen.getByLabelText("Outline management key")).toBeTruthy()
  })

  // Both are optional and mean "no ceiling" / "no default" when left blank,
  // which is why neither can be a plain zero.
  it("offers a key ceiling and a default quota", () => {
    openDialog()
    expect(screen.getByLabelText("Total key limit (optional)")).toBeTruthy()
    expect(screen.getByLabelText("Default data limit")).toBeTruthy()
  })

  it("converts the USD cost to MMK at the static rate", () => {
    openDialog()
    expect(screen.getByText("= 27,000 MMK")).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Instance cost (USD / month)"), {
      target: { value: "7" },
    })
    expect(screen.getByText("= 31,500 MMK")).toBeTruthy()
  })
})

describe("edit server dialog", () => {
  function makeDetail(overrides: Partial<ServerDetail> = {}): ServerDetail {
    const {
      hostname,
      health,
      keyCount,
      activeKeys,
      totalUsedBytes,
      metrics,
      dailySeries,
      ...server
    } = makeServer()
    return {
      server,
      hostname,
      // The live LSD 1 Yamin server as it looks before anyone has set
      // "hostname for access keys" on it: reachable over its domain, but no
      // key carries a host yet.
      accessKeyHostname: "",
      resolvedIp: "203.0.113.10",
      health,
      metrics,
      keys: [],
      keyMetrics: null,
      dailySeries,
      bandwidthUsedBytesThisMonth: 0,
      bandwidthTrackingSince: null,
      bandwidthTrackingComplete: true,
      ...overrides,
    }
  }

  function openDialog(detail: ServerDetail) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <EditServerDialog
          serverId={detail.server.id}
          detail={detail}
          open
          onOpenChange={() => {}}
        />
      </QueryClientProvider>
    )
  }

  const saveButton = () =>
    screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" })

  const bindButton = () =>
    screen.queryByRole<HTMLButtonElement>("button", { name: /Bind static/ })

  // Nothing has stamped a host into a key yet — the dialog should surface
  // that as a fix-it action naming the server's own domain, not a blank form.
  it("offers to bind the server's own domain when no key carries a host yet", () => {
    openDialog(makeDetail())
    expect(
      screen.getByText(/No access key carries a host yet/)
    ).toBeTruthy()
    expect(bindButton()?.textContent).toMatch(/vpn-test-1\.example\.com/)
  })

  // Saving the rest of the form (name/cost/etc.) is independent of the
  // domain bind — it must never be gated on a static-key fix nobody asked for
  // in this save.
  it("leaves Save enabled regardless of the static-key bind state", () => {
    openDialog(makeDetail())
    expect(saveButton().disabled).toBe(true) // nothing else changed yet
  })

  // Once Outline has actually stamped the server's own domain into its keys,
  // there is nothing left to fix — no alert, no button.
  it("shows no fix-it action once already bound to its own domain", () => {
    openDialog(makeDetail({ accessKeyHostname: "vpn-test-1.example.com" }))
    expect(screen.queryByText(/No access key carries a host yet/)).toBe(null)
    expect(bindButton()).toBe(null)
  })

  // A host that doesn't match the server's own domain (e.g. a raw IP) is
  // flagged as the actual bug this fixes — it must not be silently accepted.
  it("flags a bound host that isn't the server's own domain", () => {
    openDialog(makeDetail({ accessKeyHostname: "49.12.88.4" }))
    expect(screen.getByText(/not this server's own domain/)).toBeTruthy()
    expect(bindButton()?.textContent).toMatch(/vpn-test-1\.example\.com/)
  })
})

describe("AS share list", () => {
  it("renders the AS org and share", () => {
    render(<AsShareList ases={[frontiir]} />)
    expect(screen.getByText("Top ASes")).toBeTruthy()
    expect(screen.getByText(/Frontiir Co., Ltd · 100%/)).toBeTruthy()
  })

  it("explains an empty window rather than rendering nothing", () => {
    render(<AsShareList ases={[]} />)
    expect(
      screen.getByText("No AS traffic reported in this window.")
    ).toBeTruthy()
  })
})
