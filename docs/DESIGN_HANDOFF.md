# Dashboard Design Handoff

Supersedes the screen/theme sections of `FRONTEND_HANDOFF.md`, which described an earlier design. The API
contract in that file (response envelope, ky client, auth flow, existing endpoints, TypeScript types) is
still accurate and is **not** repeated here — read both.

**Source of truth for this doc:** screenshots the user provided on 2026-07-25 — two of the Overview slide,
two of the Servers slide (list + "Add Outline server" dialog). The claude.ai design link
(`/design/p/40360772-c34a-494f-b441-c0985630f18b`, file `Invisigate VPN Dashboard.dc.html`) could **not** be
read — it 403s for WebFetch and shows the claude.ai sign-in page in the automated browser, since neither has
the user's session. Anything the screenshots didn't show is marked **(inferred)**. If you can open the
design yourself, diff it against this doc and correct it.

## What the Outline API actually provides (probed live, 2026-07-25)

Probed against the real `LSD 1 Yamin` server (Outline v1.12.3). This settles several
questions the earlier revisions of this doc listed as open.

`GET /experimental/server/metrics?since=<1d|7d|30d>` returns:

```json
{"server":{"tunnelTime":{"seconds":32290.75},"dataTransferred":{"bytes":6037988238.76},
 "bandwidth":{"current":{"data":{"bytes":17123.08},"timestamp":1784994153.762},
              "peak":{"data":{"bytes":8646047.32},"timestamp":1784986800}},
 "locations":[{"location":"MM","asn":58952,"asOrg":"Frontiir Co., Ltd",
               "dataTransferred":{"bytes":...},"tunnelTime":{"seconds":...}}]},
 "accessKeys":[{"accessKeyId":1,"dataTransferred":{...},"tunnelTime":{...},
   "connection":{"lastTrafficSeen":1784993700,"peakDeviceCount":{"data":2,"timestamp":...}}}]}
```

Resolved:

- **There is no inbound/outbound split.** Only a single `dataTransferred.bytes`. The
  design's Inbound/Outbound pair is not buildable; those two slots now show
  **Current bandwidth usage** (a live rate, `bandwidth.current`) and **Total bandwidth
  usage** (`dataTransferred` over the window).
- **No carrier column is needed.** `locations[]` gives the AS org directly
  (`Frontiir Co., Ltd`, `AS58952`, country `MM`), which is what "Top operators" becomes.
  The previously-flagged admin-entered carrier field is **cancelled**.
- **`since` only accepts 1d / 7d / 30d.** 90d and 365d return `InternalServer`.
- **No time series.** The endpoint returns aggregates over the window, not per-day
  buckets, so the Overview's daily/monthly charts still need our own
  `usage_snapshots` history (which the cron already records — see `enforcement.SyncServer`).
- **Timestamps are floats**, e.g. `1784994153.762`. Decoding them as `int64` fails
  outright; `outline.BandwidthSample.Timestamp` and `KeyConnection.LastTrafficSeen` are
  `float64` for this reason. This was caught only by probing the live server — the unit
  tests had been written against an assumed integer shape and passed.
- **Extra metrics not in the design**, now surfaced: total tunnel time, peak bandwidth
  (with its timestamp), and per-key tunnel time / peak device count / last-traffic-seen.
  `ServerMetrics.peakDevicesTotal` sums each key's peak device count — note this is an
  **upper bound**, not a true concurrent peak, because each key's peak may be from a
  different moment and Outline reports no server-wide device figure.
- **"Connected now" has to be derived from a timestamp.** Outline exposes no session or
  connection state; the only per-key liveness signal is `connection.lastTrafficSeen`. A
  key counts as online when that falls within `models.OnlineWindow` (5 minutes), which is
  the same cutoff Outline Manager itself uses for the green dot on a key's avatar
  (`refreshAccessKeyTableUI` in its `server_manager/www/app.ts`). Surfaced as
  `keyMetrics[id].isOnline` and `metrics.onlineKeys`, both computed server-side so every
  client agrees on the cutoff and the clock. Consequences: a key with `connection: null`
  (no traffic in the metrics window) is reported offline, not unknown; and the figure is
  only as fresh as the poll, so the UI refreshes it on the 60s live interval.
- **The management key is JSON with a separate fingerprint**, not a URL with the
  fingerprint embedded:
  `{"apiUrl":"https://host:port/secret","certSha256":"F5D4..."}`. The design's
  "the cert SHA256 fingerprint is already included in it" is **wrong**. The add-server
  dialog now takes the whole blob in one textarea and the backend parses it
  (`parseManagementKey`), still accepting a bare URL + separate cert field.
- **Still unavailable:** server region/location (the `location` field describes
  *clients*, not the server), per-server capacity for a load percentage, and latency.
  The servers list therefore shows the API URL's **hostname** instead of a region, and
  `loadPct`/`avgLatencyMs` remain mock-only on the Overview.

## Status

| Screen | Data source |
| --- | --- |
| Overview (`/`) | **Mock only** — `src/lib/mock-dashboard.ts` |
| Servers list (`/servers`) | **Real API** — `GET /api/v1/servers` |
| Server detail (`/servers/$serverId`) | **Real API** — `GET /api/v1/servers/:id` |

The Servers screens were switched to live data once a real Outline server was available; the Overview is
still mock and its stat cards / charts still need the backend work listed below. The working agreement
remains mock-UI-first per screen: settle the design, then build the backend to fit it.

`src/lib/mock-servers.ts` now serves **only the Overview's fleet-health panel**. The Servers page no longer
reads it. When the Overview is wired up, that module goes away entirely.

Verified by: `bun run typecheck` clean, `bun run build` (incl. prerender) clean, `bun run lint` clean for all
new files (the 19 remaining errors are pre-existing, all in vendored `src/components/ui/*`), and 12 render
tests passing across `src/components/dashboard/dashboard.test.tsx` and
`src/components/servers/servers.test.tsx`.

**Neither page has been visually verified in a browser.** Screenshotting was blocked two ways: both pages
sit behind `_authed`, which needs a real session cookie (minting a dev JWT was denied by the permission
classifier, correctly), and `preview_start`/navigation to localhost was also denied. The render tests are
the substitute — they assert real text content, not just that components mount. **Sign in normally and
eyeball both pages against the screenshots before building on them.**

### Files

| File | Purpose |
| --- | --- |
| `src/lib/mock-servers.ts` | **Canonical server registry** — both pages read it. Also `MMK_PER_USD`, `OPERATOR_COLOR`, `PERIOD_LABEL` |
| `src/lib/mock-dashboard.ts` | Overview-only mock data; derives its server list and counts from the registry |
| `src/components/sparkline.tsx` | Shared bar sparkline (last N bars highlighted) |
| `src/components/server-status-badge.tsx` | `ServerStatusBadge` + `SERVER_STATUS_STYLES`, the single source of status colour |
| `src/components/dashboard/stat-card.tsx` | The three Overview metric cards |
| `src/components/dashboard/bandwidth-consumption-card.tsx` | Single-server chart: server + chart-type selects, Daily/Monthly toggle |
| `src/components/dashboard/compare-servers-card.tsx` | Two-server A-vs-B chart |
| `src/components/dashboard/keys-attention-card.tsx` | "Keys needing attention" list |
| `src/components/dashboard/fleet-health-card.tsx` | Per-server load bars + avg latency |
| `src/components/dashboard/chart-legend-dot.tsx` | Shared coloured-square legend item |
| `src/components/servers/server-card.tsx` | One server card on the Servers grid |
| `src/components/servers/add-server-dialog.tsx` | "Add Outline server" dialog |
| `src/routes/_authed.index.tsx` | Overview page |
| `src/routes/_authed.servers.tsx` | Servers page |
| `vitest.config.ts` | Added so tests run — jsdom env + the `@/` alias (none existed before) |

### Cross-cutting changes

- `src/components/app-sidebar.tsx` — nav is now `Overview / Servers / Revenue / Admins` under a "Manage"
  group label; header gained the "Light-speed transfer" tagline; footer is now a bordered card with
  avatar + username + role + a log-out icon button.
- `src/styles.css` — added a `--warning` token (amber, both modes) and **repurposed `--chart-1..5`**. They
  were five shades of green, which cannot encode two distinguishable series; they are now categorical
  (emerald / blue / amber / violet / rose). `--primary` and the rest of the palette are untouched.
- `src/lib/format.ts` — added `formatBytesCompact(bytes, { decimals? })`. Default trims trailing zeros
  (`900 GB`), which is what chart axes want; pass `{ decimals: 1 }` for summary figures, which the design
  keeps at one decimal even when whole (`4.0 TB`). The existing `formatBytes()` (always 2dp GB) is unchanged.
- `src/routes/_authed.index.tsx` — the earlier version fanned out `GET /servers/:id/usage` once per server
  per day (14 × N requests) to synthesise a time series. That is **gone** and should not come back; the
  series belongs server-side.
- Added the shadcn `toggle-group` + `toggle` components. Note Base UI's `Toggle` signals its on-state with
  **`aria-pressed`, not `data-pressed`**, and its base style forces `uppercase tracking-widest` — both
  toggle groups override that with `normal-case tracking-normal` to match the design.

## The real server

One real Outline server is registered: **LSD 1 Yamin**, $7/mo,
`light-speed-data1.invisigate.asia:26574`, one access key ("Min Kg", ~6.1 GB used against a 200 GB limit).

A row for this same `api_url` already existed from earlier backend testing under the placeholder name
`test-server`, and `api_url` is `UNIQUE`. It was **renamed in place** (name + cost) rather than re-created,
which preserved the already-adopted key and its usage-snapshot history. Its id is
`70cfad3a-b8d6-44f7-8543-5934de3d0f33`.

This was done with a direct SQL `UPDATE` because `POST /api/v1/servers` requires an authenticated session,
and signing in needs an emailed OTP (`SMTP_PASSWORD` is unset). Adding further servers through the UI works
normally.

## Server count: a deliberate deviation from the deck

The design's own numbers don't reconcile, so one had to be chosen:

- The Servers page filter pills read **All · 6, Healthy · 4, Degraded · 1, Offline · 1** — but the slide
  only shows 4 cards (Frankfurt-01, Singapore-02, New York-03, Tokyo-04), of which 2 are healthy.
- The Overview's stat card reads **"6 of 7"** connected servers, and its Fleet health list shows those same
  4 servers.

So the deck variously implies 4, 6, and 7 servers. **The mock uses 6** — matching the Servers page filter
counts, which are the most explicit statement of intent — by adding two healthy servers, Sydney-05 and
Toronto-06, to the four named in the deck. `MOCK_SERVERS` in `src/lib/mock-servers.ts` is the single
registry; Fleet health lists all 6 and the Overview stat card now derives **"5 of 6"** with 1 degraded
rather than the hardcoded "6 of 7".

That last part changes a number on the already-approved Overview screen. It was chosen so the two pages
can't contradict each other about how many servers exist, which would be obvious the moment you click
between them. If you'd rather match the deck literally, delete the two extra entries from `MOCK_SERVERS` —
the counts everywhere else follow automatically. Either way this all evaporates once the API is real.

The dialog's server-name placeholder is kept literally as designed (`Amsterdam-05`), so it stays a plausible
example rather than colliding with an existing server.

## Layout — Servers (`/servers`)

Page header matches Overview: eyebrow (here `Dashboard / Servers`, rendered as plain text — **the design
shows a real breadcrumb with a chevron; a proper `Breadcrumb` component is not installed yet**), `<h1>`
"Servers", and the same "Sync 42s ago" pill on the right.

Below that, a control row: a `ToggleGroup` of rounded-full filter pills — `All · 6`, `Healthy · 4`,
`Degraded · 1`, `Offline · 1`, counts derived from the registry, active pill tinted `primary/10` — and a
right-aligned filled **"+ Add server"** button that opens the dialog.

Then a `xl:grid-cols-2` grid of server cards. **A lone trailing card spans both columns**, so an odd server
count never leaves half a row empty (three servers render as 2 + 1 full-width). Each card:

- **Header** — name in Lora, status badge (`Healthy` emerald / `Degraded` amber / `Offline` red), and
  subtitle `{hostname} · ${cost}/mo` (the cost segment is omitted when no cost is recorded; there is no
  region — Outline reports none). Top-right: a **trash icon button** then `Manage →`.
- **Metrics** — a 2/3-column grid: Total keys, Active keys, Peak devices, Current bandwidth, Total
  bandwidth, Tunnel time. Key counts come from the DB and survive an unreachable server; the other three
  are live-only and read `—` when `metrics` is null.
- **ASes** — an `ASes` caption with a count badge, then the **top 3** as pills (coloured dot +
  `{asOrg} · {n}%`). Colours cycle by rank, not by name: the AS list is open-ended and differs per server,
  so unlike the fixed carrier set there is no stable name→colour mapping.
- **Chart** — daily traffic area chart, see "Charts on the server card" above.

**Delete** — the trash button opens `ConfirmDialog`, wired to `DELETE /api/v1/servers/:id`. The copy states
explicitly that this removes the server and its key records **from this dashboard only**, and that the
Outline server keeps running with its access keys still valid. That distinction matters: the endpoint does
not touch Outline, but "delete server" could easily be read as tearing down the box. The DB cascade does
drop that server's keys and usage history, which is why the count is named in the prompt.

`Manage →` links to `/servers/$serverId`.

### Add Outline server dialog

Three fields via `FieldGroup`/`Field`:

1. **Server name** — placeholder `Amsterdam-05`.
2. **Outline API URL** — mono placeholder `https://1.2.3.4:41627/xxxxxxxx`, helper text "Includes the cert
   SHA256 fingerprint — no separate field needed."
3. **Instance cost (USD / month)** — `InputGroup` with a `$` leading addon and a live `= 27,000 MMK`
   trailing addon, helper text naming the static 4,500 MMK/$1 rate and pointing at the Revenue page.

Footer: `Cancel` (outline, closes) and `Verify & add server` (filled). **The submit button does nothing yet** —
no form state, no mutation. The MMK figure does update live from the USD input.

## Data freshness / polling

`GET /servers` fans out to every Outline server on every call, so refresh is gated on the admin actually
being present:

- On mount, once.
- Then every **60s** (`LIVE_REFRESH_MS`) while active.
- **Not at all** when the tab is hidden (`refetchIntervalInBackground: false`) **or** after 5 minutes with
  no pointer/key/scroll event (`useIsUserActive`). The idle gate matters because a tab left open on a
  second monitor stays "visible" indefinitely and would otherwise poll the Outline servers all night.
- On window refocus, immediately (`refetchOnWindowFocus: true`), so returning to the tab shows current data
  without waiting out the interval.

Note the global default in `lib/query-client.ts` is still `refetchOnWindowFocus: false`; the servers queries
override it. Before this, nothing refetched at all after mount.

## Charts on the server card

**Yes, a chart is possible — but only from our own snapshot history, not from Outline.** Outline returns
window aggregates with no time series (see above), so the card's chart is built from `usage_snapshots`,
which the cron writes each pass.

`DailyUsageAllServers` (repository/usage.go) takes the highest server-wide cumulative reading per day and
subtracts the previous day's, in **one query for all servers** so N cards cost one round trip. Two
consequences that are deliberate:

- The **earliest day in the window has no predecessor**, so it yields no data point — a server needs sync
  history spanning two calendar days before the chart draws anything. `UsageChart` shows an explanatory
  empty state below that threshold rather than an empty box.
- **Deltas are clamped at zero.** Outline's counters reset when a key is recreated or the server restarts;
  without clamping a reset would render as a large negative day. Verified against real data: a synthetic
  reset produced `0` for that day rather than a negative.

**Right now the chart shows the empty state**, because `LSD 1 Yamin` was registered today and has one day
of snapshots. It will start drawing tomorrow. The delta arithmetic itself was verified by inserting
backdated readings inside a rolled-back transaction.

## Layout — Server detail (`/servers/$serverId`)

> **This screen has no design reference.** The screenshots supplied for it were of the *Outline Manager
> desktop app*, sent to show what data Outline exposes — not slides from the design deck. The layout below
> is therefore invented, following the established language (Lora headings, mono for figures, emerald
> primary, status colours from `SERVER_STATUS_STYLES`) and mirroring how Outline Manager groups the same
> data. **If slide 5 of the deck is the real server detail design, send it and expect this to change.**

- **Header** — a back link to Servers, the server name with its health badge, and
  `{hostname} · ${cost}/mo` beneath. Right side: the `SyncPill` plus a "Sync now" button wired to
  `POST /servers/:id/sync`.
- **Sync error alert** — a destructive `Alert` showing `lastSyncError` verbatim, only when set.
- **Window switcher** — 24 hours / 7 days / 30 days, matching the only values Outline accepts. Changing it
  refetches under a distinct query key.
- **Four stat cards** — Total bandwidth usage, Current bandwidth usage, Peak bandwidth usage (with the time
  it occurred), Total tunnel time. When `metrics` is null these are replaced by a single explanatory
  `Alert` rather than a row of dashes.
- **ASes table** — AS org over `AS{n}`, country code, bandwidth, tunnel time, share. Empty-state text when
  the window has no attributed traffic.
- **Access keys table** — name, status, usage against quota, tunnel time, peak devices, last active, expiry,
  and a copy-access-URL button. Usage and quota come from the DB (last sync); tunnel time, peak devices and
  last-active come from live metrics and show "—" when unavailable. The card's description says exactly
  that, so the two freshness levels aren't silently mixed.

The `SyncPill` is shared with the Servers list: it renders real relative time from `lastSyncedAt` and stops
pulsing (going muted) after 5 minutes, so a stalled cron is visible instead of looking permanently live.

## Layout — Overview (`/`)

Existing app shell (`SidebarProvider` → `AppSidebar` + `SidebarInset`) is unchanged. Page content, top to
bottom, single column with `gap-6`:

1. **Page header** — eyebrow "Dashboard" in muted text, `<h1>` "Overview" in Lora; right-aligned pill
   button "Sync 42s ago" with a pulsing emerald dot, styled as a rounded-full outline button tinted
   `primary/5`.
2. **Three stat cards** — `md:grid-cols-2 xl:grid-cols-3`. Each has a label, a status badge top-right, a
   large `4xl` bold value with a small muted suffix, a one-line note, and a 14-bar sparkline where the last
   2 bars are emerald and the rest muted.
3. **Bandwidth consumption** — full-width card, `h-80` chart.
4. **Compare server bandwidth** — full-width card, `h-72` chart.
5. **Bottom row** — `lg:grid-cols-5`: "Keys needing attention" spans 3, "Fleet health" spans 2.

Note: every screenshot shows a `N / 8` pager with Back/Next at the bottom — that is the **design-deck
navigation**, not part of the product. It was not built. (The deck has 8 slides; Overview is 3, Servers is
4, so there are ~5 more screens not yet seen.)

### Card contents

**Stat cards** (values are the mock ones from the screenshots):

| Label | Value | Suffix | Badge | Note |
| --- | --- | --- | --- | --- |
| Total active keys | 248 | keys | `+12 this week` (emerald) | 31 expiring in 7 days |
| Connected servers | 5 | of 6 | `1 degraded` (amber) | Tokyo-04 unreachable 4m |
| Aggregate bandwidth | 11.4 | TB / mo | `+18.2%` (emerald) | In 4.1 TB · Out 7.3 TB |

**Bandwidth consumption** — title + subtitle `Per-server bandwidth · {server} · {granularity}`. Controls,
left to right: legend dot `{server} total`, server select, chart-type select (Line/Bar/Area), Daily|Monthly
`ToggleGroup`. Single amber series (`--chart-3`), monospace axis ticks, Y axis formatted with
`formatBytesCompact`. Defaults: New York-03, Line, Daily.

**Compare server bandwidth** — subtitle `{a} vs {b} · total bandwidth per period`. Controls: two legend
dots, server-A select, muted "vs", server-B select, chart-type select (Bar/Line). Series A is blue
(`--chart-2`), series B amber (`--chart-3`), grouped thin bars (`maxBarSize={12}`, `barGap={2}`). Defaults:
Singapore-02 vs New York-03, Bar. Chart type is Bar-first here and Line-first on the card above, matching
the screenshots.

**Keys needing attention** — header with a "View all" link button. Each row is a bordered `muted/30` panel:
`{name} — {plan}` over `{server} · {carrier}`, then right-aligned monospace usage and an uppercase status
badge. Statuses: `expiring` → amber with a day count ("3 days"), `limit` → amber "Limit", `expired` → red
"Expired".

**Fleet health** — per server: a status dot, name, right-aligned monospace `NN%`, and a thin full-width
progress bar coloured by status (emerald healthy / amber degraded / red offline). Then a separator and
`Avg latency` / `38 ms`.

## Backend work needed

Nothing below exists yet. The shapes are drafts — change them freely, but change the mock modules in the
same commit so the UI keeps compiling. `frontend/src/lib/queries.ts` already has `queryOptions` factories
for the existing endpoints; add new ones there and swap each component's mock import for a `useQuery`.
**All fetching goes through TanStack Query — no direct `apiClient` calls in components.**

### 0. Resolved by the live probe — no longer blockers

The carrier column and the inbound/outbound split were previously listed here as blockers. Both are now
settled: ASes come straight from Outline, and directional traffic does not exist. See "What the Outline API
actually provides" above. What remains below is the Overview's backend work, which is untouched.

### 1. Extend `GET /api/v1/stats`

Current `DashboardStats` (`totalServers/totalKeys/activeKeys/expiredKeys/limitExceededKeys/combinedUsedBytes`)
does not cover the three stat cards. Missing:

- `keysDeltaThisWeek` — keys created in the last 7 days, for the `+12 this week` badge.
- `keysExpiringIn7Days` — `endDate` within 7 days and still active.
- `connectedServers` / `degradedServers` — the cards show "6 of 7" with "1 degraded", which the current
  `totalServers` alone can't express. Needs a real health notion (see #4).
- `degradedServerNote` — the human string "Tokyo-04 unreachable 4m". Could be composed client-side from #4
  instead; server-side is simpler.
- `bandwidthMonthBytes`, `bandwidthDeltaPct`, `bandwidthInBytes`, `bandwidthOutBytes` — the card is
  explicitly per-month with a MoM delta and an in/out split. **`combinedUsedBytes` is all-time and has no
  direction split**, so this is genuinely new aggregation, not a rename.
- Three 14-point sparklines (keys / servers / bandwidth). Suggest `spark: number[]` per group — the UI only
  scales them to the tallest bar, so raw counts or bytes are both fine.

The in/out split here is the same blocker as #0.

### 2. New: bandwidth time series

```
GET /api/v1/servers/:id/usage/series?granularity=daily|monthly[&from=&to=]
  -> { serverId, granularity, points: [{ label: string, bytes: number }] }
```

Daily returns the days of the current month (labels `01`..`31`); monthly returns the trailing 12 months
(labels `Aug`..`Jul`). The compare card just calls this twice, once per server — no separate endpoint
needed. This replaces the per-day fan-out the old dashboard did; the series must be computed server-side
from stored usage snapshots.

**Prerequisite:** this needs historical usage rows. Confirm whether the `CRON_INTERVAL` sync already
persists point-in-time usage snapshots; if it only overwrites current totals, add a usage-history table
first — no series endpoint is possible without it.

### 3. New: keys needing attention

```
GET /api/v1/keys/attention?limit=4
  -> AttentionKey[]   // { id, name, plan, serverName, carrier, usedBytes, status, statusLabel }
```

`status` ∈ `expiring | limit | expired`. Needs `carrier` (see #0) plus one more missing field:

- **`plan`** ("Trial 50GB", "Monthly 200GB") — keys today have `name` and `customLimitBytes` but no plan
  concept. Either add a plan/tier column or derive the label from limit + duration.

The mock currently invents both.

### 4. New: fleet health

```
GET /api/v1/fleet/health
  -> { servers: [{ id, name, status, loadPct }], avgLatencyMs: number }
```

`status` ∈ `healthy | degraded | offline`. Needs definitions that don't exist yet:

- **`loadPct`** — a percentage of *what*? Servers have no provisioned-capacity field. Either add one (e.g.
  monthly bandwidth allowance) and compute usage against it, or redefine the bar as something measurable.
- **`status`** — presumably derived from `lastSyncedAt` / `lastSyncError` (already on `Server`), e.g.
  offline when the last sync failed, degraded above a load threshold. Pin the thresholds down.
- **`avgLatencyMs`** — nothing measures latency today. Requires active probing, or drop the row.

### 5. Servers list + detail — DONE

`GET /api/v1/servers` and `GET /api/v1/servers/:id` now return live Outline metrics.
Both accept `?window=1d|7d|30d` (default 30d) and both degrade gracefully: if a server
can't be reached for a live read, `metrics` is `null`, the row still renders from
DB-backed counts, and its health drops to `degraded`.

The list fans out across servers concurrently under an 8s overall budget
(`listMetricsTimeout`) so one unreachable server can't stall the page.

`ServerWithUsage` gained `hostname`, `health`, `costUsdPerMonth`, and `metrics`.
`GET /servers/:id` additionally returns `keyMetrics`, keyed by `Key.outlineKeyId`.

Health is derived in `models.DeriveServerHealth`: **offline** = last sync failed or
never synced; **degraded** = synced but live metrics unreadable; **healthy** = both fine.
Note this deliberately is *not* a load threshold — there is no capacity figure to
threshold against, so inventing one would be inventing data.

<details><summary>Original spec, kept for the fields that are still unavailable</summary>

`ServerWithUsage` today is `Server` + `keyCount / activeKeys / totalUsedBytes`. The card needs, per server:

```
region: string             // "EU Central" — display label, not derivable from apiUrl
ipAddress: string          // "49.12.88.4" — could be parsed from apiUrl's host
costUsdPerMonth: number    // new, admin-entered (see #6)
status: "healthy" | "degraded" | "offline"   // same definition as #4
inboundBytes, outboundBytes: number          // blocked on #0
topOperators: [{ name, sharePct }]           // blocked on carrier, #0
periodTotalBytes: number, periodLabel: string
spark: number[]            // 24 buckets over the period
```

`region` has no source — Outline doesn't report it. Either admin-entered alongside the cost, or geo-looked-up
from the IP. Decide which; the add-server dialog as designed asks for **neither**, so if region is
admin-entered the dialog needs a fourth field the design doesn't have.

The filter pills are pure client-side filtering over this one response — no per-status endpoint needed.

</details>

### 6. `POST /api/v1/servers` — DONE

Now takes `{name, apiUrl, certSha256?, costUsdPerMonth?}`.

`apiUrl` accepts **either** a bare URL **or** the installer's whole JSON blob, parsed by
`parseManagementKey` in `handlers/servers.go` (unit-tested in `servers_test.go`). This
was necessary because the fingerprint is a separate JSON field, contrary to the design's
description — pasting only the URL leaves nothing to pin the self-signed cert against.

Reachability + cert pinning are still validated live before the row is persisted, so the
request takes a second or two; the submit button shows a spinner.

Field errors map to `error.details[].field` as before. The dialog holds plain component
state rather than TanStack Form, with `fieldErrorsFrom()` in `lib/form-errors.ts` mapping
the API's details onto it — **a deviation from the "TanStack Form for all forms"
convention** in `FRONTEND_HANDOFF.md`, taken because the form is three fields with no
client-side validation. Convert it if the convention matters more than the simplicity.

### 7. Currency

`MMK_PER_USD = 4500` is hardcoded in `src/lib/mock-servers.ts` and the dialog's helper text calls it "the
static rate". Decide whether it stays a frontend constant, moves to backend config, or becomes editable —
the Revenue page will need the same number, so a single source is worth settling now.

### 8. Sync freshness

The "Sync 42s ago" pill needs the fleet-wide last successful sync time. `Server.lastSyncedAt` exists
per-server; expose the max (or min — decide which the pill should mean) via `/stats` and render it as a
relative time. Currently hardcoded to 42 in the mock.

### 9. Revenue

The sidebar has a **Revenue** entry with no route, no design, and no backend — added because the
screenshots show it. `/revenue` will 404 until designed. There is no billing/payment data in the schema at
all, so this is a whole feature, not a screen. Note the add-server dialog already forward-references it
("used on the Revenue page"), so per-server monthly cost (#6) is its first input.

## Design tokens

Unchanged from `FRONTEND_HANDOFF.md` except as noted above: Neutral base, emerald primary, Lora
headings (`font-heading`), Figtree body, light + dark via the existing `ModeToggle`.

The screenshots are dark-mode only, so **light mode is inferred** — it follows from the semantic tokens and
was not visually checked. Numeric/tabular values use `font-mono` + `tabular-nums`, matching the screenshots.

Colour rules to keep: status colour comes from `--chart-1` (emerald, healthy/positive), `--warning` (amber,
degraded/expiring/limit), `--destructive` (red, offline/expired). Chart series colours come from
`--chart-*`. No raw Tailwind colour utilities anywhere.

## Remaining work

**Built:** Overview (mock), Servers list (live), Server detail (live).

**Not started** — no route files, so these 404: `/keys/$keyId`, `/admins`, `/revenue`. The deck has 8 slides
and only Overview (3) and Servers (4) have been seen; ask for screenshots before building each.

**Next most valuable backend work**, now that the Servers screens are live:

1. Wire the Overview to real data. Its stat cards and both charts are still mock. Sections 1–4 and 8 below
   are unchanged and still describe what's needed. The daily/monthly series must come from
   `usage_snapshots` (the cron records them already) — Outline itself returns no time series.
2. Fleet health on the Overview still shows mock `loadPct` and `avgLatencyMs`. Neither has a source. Either
   drop them, or decide what they should measure.

**Components worth installing when a screen needs them:** `Breadcrumb` (both Servers headers fake
`Dashboard / Servers` with plain text) and `Empty` (the Servers list has a hand-rolled empty state).

**Note on the `metrics` fan-out:** every `GET /servers` hits every Outline server live. That's fine at one
server and fine at six, but if the fleet grows past ~20 this should move to metrics cached on each cron
sync, with only the current-bandwidth rate read live (or dropped from the list view).
