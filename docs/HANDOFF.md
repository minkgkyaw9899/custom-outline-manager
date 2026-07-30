# Handoff — business logic, current state, and suggested next steps

Read this first. [ARCHITECTURE.md](ARCHITECTURE.md) is still accurate for the
backend's core reconciliation model (§4–§8 there: Outline API integration,
status computation, the enforcement cron, quota renewal math, dynamic access
keys) and is worth reading in full for that depth — this file exists because
ARCHITECTURE.md predates the `users` table, pricing/revenue, and the entire
frontend, and doesn't cover them. [DESIGN_HANDOFF.md](DESIGN_HANDOFF.md) and
[FRONTEND_HANDOFF.md](FRONTEND_HANDOFF.md) are early-stage specs written
*before* the frontend existed — useful for design intent, but the frontend
itself is now the source of truth for what actually shipped.
[SESSION_HANDOFF.md](SESSION_HANDOFF.md) is obsolete (pre-dates almost
everything below) and can be deleted once nothing references it.

## 1. What this is

A self-hosted admin dashboard for **reselling VPN access keys** on top of
self-hosted Outline (Shadowbox) servers. One person (the root admin, currently
the only real admin) runs one or more Outline servers, sells time-and-data-
limited access keys to individual people ("holders"), and uses this dashboard
to provision, price, monitor, and renew those keys — since stock Outline
Server has no concept of expiry, quota top-ups, or per-key pricing.

Two audiences use this system:
- **The admin** — signs in with email+OTP, sees everything, at
  `/admin/*` in the frontend.
- **Key holders** (customers) — never see the admin dashboard. Each gets one
  passcode-protected public link (`/users/keys-status/:slug`) showing their
  own usage/quota/expiry and their connection links. No admin functionality,
  no visibility into other holders, servers, or pricing.

## 2. Core concepts and how they relate

```
Server (an Outline VPN box)
  └─ has many Keys (an Outline access key: connection creds + quota + expiry)
       └─ optionally belongs to one User (a holder — a person, not a device)

User (a holder)
  ├─ has a stable ssconf:// dynamic link (survives being moved to a different key/server)
  ├─ has a primary_key_id — which of their keys that dynamic link currently resolves to
  ├─ optionally has a UserShare (passcode-protected public status page)
  └─ is NOT the same as an AdminUser (dashboard operator) — same `users` table
     concept name collision only in casual conversation; they're entirely
     separate tables (`users` vs `admin_users`)
```

The **User ↔ Key split is the load-bearing design decision** in this whole
system: a key is tied to one physical Outline server and has Outline's own
connection credentials baked in. A person's *link* (both the dynamic
`ssconf://` link and the passcode-protected status page) is tied to the
**user**, not the key, specifically so that renewing, moving, or replacing
someone's key never requires resending them a new link. Everywhere in the
codebase that touches "which key is this," check whether the *user's*
identity should stay stable across it — it almost always should.

## 3. Data model (16 migrations, in order)

| # | Added |
|---|---|
| 0001 | `servers`, `keys`, `renewal_logs`, `usage_snapshots` — the core Outline-key model |
| 0002 | `admin_users`, `otp_codes`; seeds the immutable root admin |
| 0003 | `servers.cost_usd_per_month` (hosting cost, USD) |
| 0004 | `key_shares` (early key-centric share links — superseded, see 0007) |
| 0005 | `keys.password`, `keys.dynamic_token` (dynamic access keys, §8 of ARCHITECTURE.md) |
| 0006 | `users` table, `keys.user_id`, `servers.max_keys`, `servers.default_limit_bytes` |
| 0007 | Moves the dynamic link from key → user: `users.dynamic_token`, `users.primary_key_id`, `user_shares` (replaces `key_shares`, which is dropped) |
| 0008 | Drops `users.email`/`users.phone` — never used; a holder is identified by name only |
| 0009 | `servers.deleted_at` — soft-delete/revive (see §4 below) |
| 0010 | `servers.default_price_mmk`, `keys.price_mmk` — MMK sale pricing |
| 0011 | `revenue_snapshots` — daily revenue/cost history for trend charts |
| 0012 | `servers.bandwidth_limit_bytes`, `bandwidth_disabled_at`, `bandwidth_reenabled_at` — per-server monthly bandwidth kill switch (§4) |
| 0013 | `keys.low_usage_alert_sent_at` — debounce timestamp for Telegram low-usage/near-expiry alerts (§4) |
| 0014 | `renewal_logs.paid`, `renewal_logs.payment_note` — payment bookkeeping per renewal (§4) |
| 0015 | `device_alerts` table — debounce for the Telegram device-count alert (§4) |
| 0016 | `keys.auto_renew` — opt-in automatic top-up (§4) |

Full column-level detail for `servers`/`keys`/`renewal_logs` is in
ARCHITECTURE.md §3 and is still accurate. Not covered there: `users`,
`user_shares`, `admin_users`, `otp_codes`, `revenue_snapshots` — read the
migration files directly for those, they're short and self-explanatory.

## 4. Business rules worth knowing before you touch anything

**Nullable vs. zero, everywhere.** `custom_limit_bytes`, `price_mmk`,
`default_price_mmk`, `default_limit_bytes` all use `NULL` = "not set /
inherits a default" and `0` (or an explicit value) = "deliberately set to
that." A free key is `price_mmk = 0`, not `NULL` (`NULL` means *unpriced*,
which is a data-quality warning on the Revenue page, not a price).

**Soft-delete + revive for servers** (migration 0009). `DELETE /servers/:id`
never actually deletes the row — it sets `deleted_at`. Every normal read
filters `deleted_at IS NULL`. Re-adding the *same* server (same `apiUrl` +
`certSha256`) revives the archived row in place instead of creating a
duplicate, so its keys/renewal history/usage snapshots all come back intact.
`api_url` uniqueness is a partial index scoped to non-deleted rows for this
reason.

**Plan minimums.** `MIN_PLAN_GB = 200`, `MIN_PLAN_DAYS = 30`
(`models.MinPlanGB`/`MinPlanDays`, backend; `MIN_PLAN_GB`/`MIN_PLAN_DAYS`,
frontend `lib/format.ts`) — a key is never created or renewed with less. This
is the standard plan size, referenced constantly (new-key defaults, renewal
floors, the "reset usage" replacement plan).

**Free-key recycling (added this session).** When creating a new user, if the
chosen server already has an unassigned key sitting on it (created but never
claimed — from adoption, a released holder, or spare pre-provisioned
capacity), the form *always* uses that key instead of provisioning a new one
— not a choice the admin makes, `KeySourceFields` derives it automatically. A
server at its `max_keys` ceiling stays selectable if it has such a spare key.
For a **new user only**, the claimed key is renamed to the new holder's name
and put on the standard plan (200 GB / 30 days), overriding whatever
allowance it happened to carry — deliberately *not* applied when an existing
holder swaps keys (`ChangeKeyDialog`), where the free key's existing
allowance is kept as-is. See `key-source-fields.tsx` and
`handlers.claimFreeKey`/`applyKeyPlan`.

**"Reset usage" recreates the key** (added this session,
`handlers.resetUserKeyUsage`). Outline exposes no API to reset a key's
transfer counter — it only resets when the key is recreated. So "reset usage"
deletes the current key and provisions a fresh one on the same server with
the same name/plan/price, then repoints the holder's primary key at it. The
dynamic link is unaffected (§2). **Consequence to know about**: the key gets
a new internal id, so its renewal history and daily-traffic chart start over
empty — there is no way to preserve them across a reset given how Outline
works, and no `recreated_from` audit trail exists yet (see §6).

**Revenue is a live calculation, backed by a daily history since this
session.** `ServerWithUsage.monthlyRevenueMmk` is always the *current* sum of
active, **user-linked** keys' effective price — never stale, but has no
memory. As of migration 0011, `revenue_snapshots` records one row per server
per cron tick (every `CRON_INTERVAL`, default 30 min), and day/month/year
views are read by taking the **latest** snapshot within each period, never
summed (revenue is a level, not a delta — see
`repository.DailyRevenueAllServers`). History starts empty from whenever 0011
was deployed and has no backfill.

**Revenue excludes unlinked keys (added this session).**
`monthlyRevenueMmk`/`unpricedActiveKeys`/`freeActiveKeys` (`ListServers` in
`repository/servers.go`, and the identical computation in
`SnapshotRevenue`/`revenue.go`) all now additionally require
`k.user_id IS NOT NULL`. A key just adopted from Outline (or otherwise never
claimed by a holder) starts unlinked — it was inflating revenue for a renter
who doesn't exist. `activeKeys`/`keyCount` deliberately stay unfiltered: those
are operational counts (denominators in the UI, e.g. "N active keys", "X /
activeKeys paying"), not revenue inputs. Renewal (see the auto-renew
paragraph below) already reconciles a key's `status` synchronously, so
extending a key correctly flows into the next revenue read without any
separate "revenue event" — the missing `user_id` filter was the only actual
gap.

**Bandwidth kill switch (added this session, migration 0012).** A server can
optionally carry `bandwidth_limit_bytes` (set at create/edit, e.g. 2TB). Every
cron tick, `enforcement.CheckBandwidthLimits` sums that server's *current
calendar month* usage (`ServerUsageInRange`, month-start to now) and, once it
comes within `models.BandwidthDisableMarginBytes` (2GB) of the cap, trips
`bandwidth_disabled_at` and force-pushes a 0-byte Outline limit to every key on
that server — **without touching each key's own stored `enabled`/`status`**,
so their real plan state is preserved underneath the override
(`enforcement.reconcileKey`'s `bandwidthDisabled` parameter). The admin clears
it manually (`POST /servers/:id/bandwidth/enable`), which sets
`bandwidth_reenabled_at` and immediately restores each key's real state —
`bandwidth_reenabled_at` also suppresses re-tripping within the *same calendar
month* even if usage is still technically over the cap, so a manual override
isn't immediately undone by the next tick. AWS-side bandwidth verification
(binding this to the actual instance's real network counters, rather than
Outline's own reported transfer) is explicitly deferred by the admin's own
choice — this exists to cap *Outline-visible* transfer as a cost-control
proxy, not as an infrastructure-verified guarantee.

**Telegram alerting (added this session, migration 0013).** Fully optional
and inert unless `TELEGRAM_BOT_TOKEN` is set — see `internal/config/config.go`
for the four `TELEGRAM_*` vars and their purposes. Two independent trigger
conditions, checked every cron tick by `internal/alerts.Checker.Run` (in
`cron.RunOnce`, after bandwidth checks): a key's remaining quota under 3GB, or
under 2 days to expiry (constants in `internal/alerts/alerts.go`), debounced
12h via `low_usage_alert_sent_at` so a key stuck under threshold isn't
re-alerted every tick. Each alert is one Telegram message with an inline
"Extend +200GB / +30 days" button whose `callback_data` encodes the key id
(`alerts.CallbackDataFor`/`KeyIDFromCallbackData`). A tap hits
`POST /api/v1/telegram/webhook` (public route, not behind `RequireAuth` —
Telegram has no session cookie), gated by two independent checks: the
`X-Telegram-Bot-Api-Secret-Token` header must match `TELEGRAM_WEBHOOK_SECRET`,
and the tapper's Telegram user id must match `TELEGRAM_ADMIN_USER_ID` — anyone
else's tap is acknowledged but silently ignored. A valid tap calls
`enforcement.Enforcer.RenewKey` (the **same** function the dashboard's own
"renew" endpoint calls — extracted this session so both paths share identical
renewal logic), then edits the original message to show the outcome
(used/total GB, new expiry date, or a clear failure state). Two gotchas worth
knowing if this needs touching again:
- `TELEGRAM_WEBHOOK_URL` is deliberately a **separate** setting from
  `PUBLIC_BASE_URL` — the latter points at a nginx host
  (`dynamic-access-*`) that only proxies `/api/v1/dkey/*` for privacy
  reasons (see ARCHITECTURE.md §8), so reusing it for the webhook would
  register Telegram against a URL that 404s.
- A Telegram **channel** id must be negative with a `-100` prefix (e.g.
  `-1001234567890`) — the raw id shown by some bots omits both the sign and
  makes the prefix easy to miss; confirmed the hard way this session by
  testing `sendMessage` directly against the Bot API before wiring it into
  the app.
- The four `TELEGRAM_*` values live as **separate GitHub repo secrets**, not
  folded into the `DEPLOY_ENV_FILE` blob secret — the deploy workflow's
  "Write .env" step appends them as their own lines (see
  `.github/workflows/deploy.yml`). Update them individually via `gh secret
  set TELEGRAM_BOT_TOKEN` etc. (or the GitHub UI), not by editing
  `DEPLOY_ENV_FILE`.

**Payment tracking on renewals (added this session, migration 0014).** Every
`renewal_logs` row now carries `paid` (bool, default `true` for pre-existing
rows — see the migration's own comment for why) and `payment_note` (text).
The dashboard's renew dialog (`EditKeyDialog`, "extend" mode) has a "Payment
received" switch defaulting **on** — an admin renewing a key has ordinarily
already collected payment — plus an optional note. The Telegram extend-button
webhook always logs `paid=true, note="Extended via Telegram"`; the two
zero-allowance "adjustment" paths (`applyKeyPlan`'s free-key claim, and the
manual "set exact" PATCH) always log `paid=true` since neither is a billable
event. Corrected after the fact via `PATCH /keys/:id/renewals/:renewalId/payment`
— the key detail page's renewal history table has a clickable Paid/Unpaid
badge per row wired to it (`RenewalHistory` in
`_authed.admin.keys.$keyId.tsx`). This is bookkeeping only: nothing about
`paid` affects `ServerWithUsage.monthlyRevenueMmk`, which is still "what
active keys are worth right now," not "what's actually been collected."

**Device-count alert (added this session, migration 0015).** A second,
independent Telegram sweep — alert-only, nothing here disables a key.
`enforcement.CheckDeviceLimits` runs after `CheckBandwidthLimits` each cron
tick: for every server it fetches live `GET /experimental/server/metrics`
(`outline.Window1d`, the same call the live dashboard uses, not persisted
anywhere) and flags any key whose `peakDeviceCount` exceeds a fixed threshold
(5 — generous on purpose, this is a "look into it" signal, not a verdict).
Debounced 12h via a new standalone `device_alerts` table (`key_id`, `sent_at`)
rather than a column on `keys`, since device count is never stored on the key
itself outside of a tick that actually observed a breach —
`repository.DeviceAlertSentAt`/`SetDeviceAlertSentAt`. `alerts.Checker.SendDeviceAlerts`
posts one plain-text message per flagged key (no inline button, unlike the
low-usage alert — this isn't something a tap should resolve automatically).

**Telegram bot gained read-only commands (added this session).** The webhook
(`handlers.telegramWebhook`) now also parses `message` updates (previously
only `callback_query`), gated by the same `TelegramAdminUserID` check.
`/servers` replies with each server's DB-recorded sync status (no live
Outline calls, so it's instant); `/find <name>` substring-matches a key or
holder name across `ListAllKeys` and replies with quota/expiry/status for up
to 15 matches (`telegramFindResultLimit`); `/help` lists both. All DB-only —
nothing here can change a key's state, unlike the extend button.

**Opt-in auto-renew (added this session, migration 0016).** `keys.auto_renew`
(default `false` — every existing key is unaffected until explicitly opted
in via the switch in `EditKeyDialog`). Each cron tick,
`enforcement.AutoRenewKeys` re-checks every opted-in key against the exact
same "running low" condition the Telegram alert uses (<3GB remaining or <2
days left — thresholds duplicated locally rather than imported from
`internal/alerts`, intentionally, to keep `enforcement` from depending on
`alerts`) and calls the shared `RenewKey` with the standard plan floor
(`models.MinPlanGB`/`MinPlanDays`). No separate debounce bookkeeping needed:
a renewal always grants a full period on top of current usage, so one
auto-renewal reliably pushes the key back out of the "running low" window
before the next tick. Logged **unpaid** (`autoRenewNote = "Auto-renewed —
confirm payment"`) every time — staying online automatically is not the same
as being paid for, and the admin is expected to confirm/flip it from the
renewal history table (see the payment-tracking paragraph above).

**Renewal raises a key's price to match its server's current default (added
this session, `enforcement.RenewKey`).** If a server's `default_price_mmk` is
raised after a key was already sold at the old, lower price, that key's own
`price_mmk` now catches up automatically the next time it's renewed — manual
extend or auto-renew, both call the same `RenewKey`. The rule is deliberately
narrow: only **raises**, never lowers (so a genuinely discounted key never
gets silently reset to full price by an unrelated server-wide increase going
the other way), and only touches a key whose `price_mmk` is already non-nil
(a `NULL` price already tracks the server's current default live via
`COALESCE` at read time — see the revenue paragraphs above — so there's
nothing to catch up). Never triggered by a plain key change/reissue
(`ChangeKeyDialog`) — a freshly provisioned key already gets its price from
its server's default at creation time, which is correct on its own.

**Static keys use a domain, dynamic keys use an IP — deliberately opposite
(added this session).** These are two independent host settings that used to
be able to drift out of sync with no way to fix it except retyping a raw
hostname by hand:
- A **static** `ss://` link's host is Outline's own "hostname for access
  keys" setting (`outline.Client.SetHostnameForAccessKeys`) — baked into a
  link a holder copies once and can't easily be told to re-fetch. This must
  be a **domain**, not an IP: if the underlying server ever moves to a new
  IP, repointing DNS keeps every already-distributed static key working with
  zero reissue. `EditServerDialog`'s old free-text hostname field let an
  admin type a raw IP in here by mistake (the actual bug that motivated this
  work) — it's now a read-only status ("Bound to: X", "domain resolves to:
  Y") plus a one-click **"Bind static keys to \<domain\>"** button that always
  pushes the server's own API-URL domain, never manual text
  (`handlers.updateServerConfig`, unchanged wire format — only the frontend
  affordance changed).
- A **dynamic** `ssconf://` key is re-resolved by the client on every
  connect (`handlers.dynamicKey`, `/api/v1/dkey/:token`), so a domain here
  buys nothing but an extra DNS round-trip before traffic can start. It now
  returns a **live-resolved IP** instead of the domain
  (`handlers.resolveIP`, `internal/handlers/dns.go` — skips the lookup
  entirely if the host is already a literal IP), falling back to the domain
  string if the lookup fails rather than breaking the connection over it.
  Deliberately **no stored/cached IP column** — resolved fresh on every
  request, so a DNS change (e.g. repointing a Cloudflare A record) takes
  effect immediately with no admin action, at the cost of one extra DNS
  lookup per dkey request (see §6 if this ever needs to become a cache).
- `GET /servers/:id` also now returns `resolvedIp` (same `resolveIP` helper,
  purely for display) so the edit-server dialog can show what a server's own
  domain currently resolves to — a quick sanity check that Cloudflare (or
  whatever registrar) is actually pointed where the admin thinks it is.

**QR codes (added this session).** `KeyLinkField` (shared by the key detail,
user detail, and public holder status pages — one change covers all three)
grew a QR button next to the existing copy button, rendering the link via
`qrcode.react`'s `QRCodeSVG` in a popover. Scannable by the Outline client's
own "scan to import" flow.

**Plan preset quick-picks (added this session, frontend-only).**
`PLAN_PRESETS` (`lib/plan-presets.ts`) is three GB tiers (1x/2.5x/5x
`MIN_PLAN_GB`, all at `MIN_PLAN_DAYS`) rendered as one-click chips
(`PlanPresetPicker`) in both `NewKeyDialog` and `EditKeyDialog`'s extend mode.
Deliberately doesn't touch price — that varies per admin/server and isn't
something to hardcode a figure for. No backend change; this is strictly a
faster way to fill the same GB/days fields that were always there.

**Two completely separate auth systems** — don't conflate them:
- **Admin**: email + OTP → JWT in `auth_token` cookie (`SameSite=Lax`,
  `HttpOnly`), 7-day TTL by default. Root admin is identified by
  `strings.EqualFold(email, ROOT_ADMIN_EMAIL)` on every read — not a DB flag
  — and can never be deleted or suspended via the API.
- **Holder share view**: a 6-digit passcode the holder invents on first visit
  (`/users/setup/:slug`), bcrypt-hashed, re-entered on every later visit
  (`/users/login/:slug` — despite the name, it's passcode re-entry, not a
  distinct login mechanism), locked out for 15 min after 5 wrong attempts.
  Session is a separate Bearer JWT (24h TTL), not a cookie. `/users/keys-
  status/:slug` is both the dispatcher (checks for a stored token, redirects
  to setup/login if missing) and the actual status page once authenticated.

## 5. Frontend page inventory

Admin (`/admin/*`, behind the `_authed` layout guard):
`overview` (fleet health, revenue trend, bandwidth, keys needing attention),
`users` (holders table + separate admin-operators table on one page —
holders table has a "Key type" badge column, free/paid/unpriced, price
omitted from the table itself), `users/:id` (holder detail — plan, key type +
price if paid, connection links, reset usage, change key), `servers` (fleet
cards, health filter, bandwidth-cap alert + progress bar — **no traffic chart
on the card itself as of this session**, removed as redundant with the detail
page's chart), `servers/:id` (key table with a **Holder column** — added this
session, badge shows the linked user or "Unassigned" at a glance — plus AS
breakdown, daily traffic), `keys/:id` (single key detail, renewal history
table with a clickable paid/unpaid badge per row — added this session),
`revenue` (per-server revenue/cost/profit table + trend chart, with a
free-key count alongside the existing unpriced-key count and a "N paying"
sub-line under the active-keys figure; each row links to
`revenue/:serverId`, a **per-server revenue detail page — added this
session**, same trend chart scoped to one server plus a monthly breakdown
table).

Public (no `_authed` guard): `admin.login` / `admin.verify-otp` (admin sign-
in), `users.setup.$slug` / `users.login.$slug` / `users.keys-status.$slug`
(holder passcode flow, §4).

**Theme**: `lib/theme.tsx` always supported `light`/`dark`/`system` (with
live OS-preference tracking), but until this session `ModeToggle` only ever
cycled light/dark, silently discarding "system" the moment it was clicked.
It's now a proper 3-option dropdown (`components/mode-toggle.tsx`).

**Theme recolored to emerald/mist (added this session).** shadcn's base
color went from `neutral` to a custom cool-gray "mist" (hue ~220, retaining
every prior lightness step so contrast is unaffected — see
`frontend/src/styles.css` `:root`/`.dark` blocks, and `components.json`'s
`baseColor`), and `primary`/`sidebar-primary`/`chart-1`–`chart-5` went from
the original blue ramp to Tailwind v4's real emerald oklch values (sourced
from `node_modules/tailwindcss/theme.css`, not guessed). `AuthLayout`'s
hero panel (shared by admin login, OTP verify, `order.tsx`, and the three
`ShareAuthLayout` holder screens) had its own hardcoded navy/blue gradient +
blue accent text, independent of the theme tokens — recolored to a matching
dark-emerald gradient so it's no longer a leftover from the old blue
branding. Also: the user detail page's "No key" badge is now `destructive`
(was `outline`) so a holder with no key stands out as an alert state, not a
neutral one.

**Table pagination (added this session).** `DataTablePagination`
(`components/common/data-table-pagination.tsx`, shared by the keys/users/
admins/AS tables) gained a page-size dropdown (10/20/30/60/100, via
`table.setPageSize` — no backend change, pagination has always been fully
client-side over an already-fetched list). While touching this: fixed a
real bug where saving or deleting a row while on page 2+ silently bounced
every table back to page 1 — TanStack Table's `autoResetPageIndex` defaults
to `true`, resetting on any new `data` array reference, which every
query-invalidation refetch produces even when the row count on the current
page didn't change. All four tables now set `autoResetPageIndex: false`.

## 6. Suggestions for next time

The per-server revenue detail page (previously the explicitly-chosen next
task) is **done** — see §5. This session also built, off the admin's own
request to compare against 3x-ui/Marzban and act on the gaps: payment
tracking on renewals, a device-count abuse alert, read-only Telegram
commands, plan preset quick-picks, opt-in auto-renew, and QR codes — all
detailed in §4/§5. Not done from that comparison: a fuller plan **catalog**
(a real admin-editable table of named tiers with their own prices, vs. the
lightweight frontend-only GB presets built instead — see §4's plan-presets
paragraph for why price was deliberately left out) and a self-serve
storefront/checkout (a bigger philosophical shift from admin-provisions-
everything to customer-picks-and-pays, not something to default into without
asking first).

Everything else below, ranked by value, not urgency — none of these are on
fire, and none were requested for the next session specifically:

1. **Server-down/degraded alerting via Telegram.** The alerting pipeline
   (`internal/alerts`, `internal/telegram`, the webhook) already exists for
   low-usage/near-expiry; extending it to "a server's sync has been failing"
   (there's already a `last_sync_error` column and `ServerHealth` derivation
   to key off) is a small addition on infrastructure that's already built and
   tested. Suggested but not chosen this session — worth revisiting.

2. **Verify `JWT_SECRET` is explicitly set in production**, and consider
   making `ROOT_ADMIN_EMAIL`/`SMTP_USERNAME`/`SMTP_FROM_EMAIL` required env
   vars with no hardcoded default (currently default to real personal email
   addresses baked into `config.go` and migration 0002 — flagged to the admin
   twice now, still awaiting an explicit "yes, `.env` sets these" before
   making the change, since removing the default would hard-fail boot for
   any deploy that doesn't set them).

3. **No general rate limiting anywhere** (confirmed via grep — no limiter
   middleware exists). The only anti-abuse protections are OTP attempt
   counting and share-passcode lockout, both narrowly scoped to those two
   endpoints. Worth adding basic per-IP rate limiting on the public surface
   (`/users/*`, `/api/v1/dkey/*`, `/api/v1/share/*`, and now
   `/api/v1/telegram/webhook`, though that one already has its own
   secret-token + admin-id gate) before the holder count grows enough to make
   brute-forcing worth someone's time.

4. **`MMK_PER_USD` (4500) is a hardcoded frontend constant**
   (`add-server-dialog.tsx`), used everywhere cost gets converted to MMK for
   profit math. Worth making this an admin-editable setting stored
   server-side instead of silently drifting wrong when the real exchange
   rate moves.

5. **`revenue_snapshots` and `usage_snapshots` grow forever, unbounded.**
   Both insert a new row every cron tick per server/key, no pruning. Worth a
   retention job before this becomes a real storage/query-performance
   problem — not visible yet given how young the tables are.

6. **`cmd/gentoken` mints a root-admin JWT directly from `JWT_SECRET`, no
   OTP required.** Confirmed again this session (used to seed a local demo
   instance for documentation screenshots) that `backend/Dockerfile` only
   builds `./cmd/server` — `gentoken` never ships in the production image.

7. **The UI minimalism pass is one pass, not finished.** Pass 1 removed
   redundant `CardDescription`/`DialogDescription` text. Not touched yet:
   `FieldDescription` text, spacing/density on busier pages, table column
   density.

8. **A `recreated_from_key_id` audit trail for "reset usage."** Still no
   link from a fresh key back to the one it replaced after a usage reset.

9. **README.md is stale and documentation/screenshots work is incomplete.**
   The admin asked for a public-facing setup guide + screenshots for GitHub
   this session. Progress: a release-tagging GitHub Action now exists
   (`.github/workflows/deploy.yml`'s `tag-release` job — auto-bumps
   `vMAJOR.MINOR.PATCH` and creates a GitHub Release after every successful
   deploy; first tag `v0.1.0` already cut). **Not done**: `README.md`'s
   "Frontend" section still describes the old dependency-free HTML/CSS/JS
   dashboard that predates the TanStack Start/React rewrite — needs a real
   rewrite (feature list, current architecture, link to `deploy/README.md`
   for production setup). Screenshots specifically need **fake/demo data**,
   never real customer data from the live instance (real user names, revenue
   figures, hostnames would leak into a public repo) — the intended approach,
   started but not finished this session: spin up a scratch Postgres, seed
   obviously-fake rows directly via SQL (see this session's transcript for a
   working seed script), serve the frontend via `bun run preview` with
   `VITE_API_URL` pointed at a local backend instance, and authenticate the
   browser via a real `/auth/verify-otp` round trip or the actual login UI —
   **`document.cookie` cannot be set via the browser automation tool's
   `javascript_tool`, it's explicitly blocked**, so the cookie-injection
   shortcut used elsewhere this session for API-only curl testing doesn't
   work for getting a real browser session logged in. Cleaned up (killed
   local processes, removed the scratch DB) before ending the session — no
   leftover local state.

10. **The dynamic key endpoint does a live DNS lookup on every request, with
    no cache.** Deliberate (see §4's static-vs-dynamic paragraph) since it
    keeps a DNS change effective immediately with no admin action, but worth
    revisiting if `/api/v1/dkey/:token` traffic ever gets heavy enough for
    the extra lookup to matter, or if the resolver becomes a reliability
    concern — `handlers.resolveIP` (`internal/handlers/dns.go`) is the one
    place this would need a cache/TTL added.
