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

## 3. Data model (11 migrations, in order)

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
active keys' effective price — never stale, but has no memory. As of
migration 0011, `revenue_snapshots` records one row per server per cron tick
(every `CRON_INTERVAL`, default 30 min), and day/month/year views are read by
taking the **latest** snapshot within each period, never summed (revenue is a
level, not a delta — see `repository.DailyRevenueAllServers`). History starts
empty from whenever 0011 was deployed and has no backfill.

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
breakdown, daily traffic), `keys/:id` (single key detail), `revenue`
(per-server revenue/cost/profit table + trend chart, with a free-key count
alongside the existing unpriced-key count and a "N paying" sub-line under the
active-keys figure).

Public (no `_authed` guard): `admin.login` / `admin.verify-otp` (admin sign-
in), `users.setup.$slug` / `users.login.$slug` / `users.keys-status.$slug`
(holder passcode flow, §4).

**Theme**: `lib/theme.tsx` always supported `light`/`dark`/`system` (with
live OS-preference tracking), but until this session `ModeToggle` only ever
cycled light/dark, silently discarding "system" the moment it was clicked.
It's now a proper 3-option dropdown (`components/mode-toggle.tsx`).

## 6. Suggestions for next time

**Explicitly chosen as the next task (admin's own words, end of this
session): a per-server revenue detail page.** Drill into one server from the
Revenue table to see its own monthly cost/revenue/profit breakdown and history
in more depth than the shared table row currently shows. Deliberately
deferred to a *future* session rather than built now. The
`revenueDailySeries`/`revenue_snapshots` data it needs already exists — see
§4's revenue paragraph and migration 0011 — so this is mostly a new route +
query, not new backend plumbing.

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
