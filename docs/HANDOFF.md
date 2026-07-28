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
`users` (holders table + separate admin-operators table on one page),
`users/:id` (holder detail — plan, connection links, reset usage, change
key), `servers` (fleet cards, health filter), `servers/:id` (key table, AS
breakdown, daily traffic), `keys/:id` (single key detail), `revenue`
(per-server revenue/cost/profit table + trend chart).

Public (no `_authed` guard): `admin.login` / `admin.verify-otp` (admin sign-
in), `users.setup.$slug` / `users.login.$slug` / `users.keys-status.$slug`
(holder passcode flow, §4).

## 6. Suggestions for next time

Ranked roughly by value, not urgency — none of these are on fire.

1. **`MMK_PER_USD` (4500) is a hardcoded frontend constant**
   (`add-server-dialog.tsx`), used everywhere cost gets converted to MMK for
   profit math (Overview, Revenue page, revenue snapshots' display). If the
   real exchange rate moves, every profit figure silently drifts wrong until
   someone edits code and redeploys. Worth making this an admin-editable
   setting stored server-side (a single-row config table, or a field on an
   existing settings concept) instead.

2. **`revenue_snapshots` and `usage_snapshots` grow forever, unbounded.**
   Both insert a new row every cron tick (default every 30 min) per
   server/key, with no pruning. The daily/monthly/yearly *read* queries only
   need the latest reading per period, so most rows are write-only dead
   weight within days of being written. Worth a retention job (e.g., a
   migration + cron step that collapses anything older than N days down to
   one row/day, or deletes intra-day duplicates past a cutoff) before this
   becomes a real storage/query-performance problem — it won't be visible
   until the tables are much bigger than they are today.

3. **Verify `JWT_SECRET` is explicitly set in production.** If unset, the
   backend auto-generates a random one on boot (with a log warning) — every
   process restart then invalidates *every* session, admin and holder share
   tokens alike, with no user-facing explanation beyond "please sign in
   again." Worth a one-time check that the deployed `.env` sets it explicitly
   (it should already, since `cmd/gentoken` was used against production this
   session and requires a *stable* known secret — but worth confirming
   explicitly rather than assuming).

4. **`cmd/gentoken` mints a root-admin JWT directly from `JWT_SECRET`, no
   OTP required.** Extremely useful for scripted verification (used
   throughout this session), but it's effectively an admin-auth bypass tool.
   Confirmed `backend/Dockerfile` only builds `./cmd/server` — `gentoken`
   never ships in the production image — so this is a non-issue as long as
   nobody adds a second build target later without noticing what it exposes.

5. **No general rate limiting anywhere** (confirmed via grep — no limiter
   middleware exists). The only anti-abuse protections are OTP attempt
   counting and share-passcode lockout, both narrowly scoped to those two
   endpoints. Low risk today given a single-admin, small-holder-count
   deployment, but worth adding basic per-IP rate limiting on the public
   surface (`/users/*`, `/api/v1/dkey/*`, `/api/v1/share/*`) before the
   holder count grows enough to make brute-forcing worth someone's time.

6. **A per-server revenue detail page** — requested but not yet built:
   drilling into one server from the Revenue table to see its own monthly
   cost/revenue/profit breakdown and history in more depth than the shared
   table row currently shows. Natural next feature; the `revenueDailySeries`
   data needed already exists on `ServerWithUsage`.

7. **The UI minimalism pass is one pass, not finished.** Pass 1 (this
   session) removed redundant `CardDescription`/`DialogDescription` text that
   only restated its own title. Deliberately *not* touched yet: form-field
   `FieldDescription` text (mostly functional — validation hints, plan-floor
   explanations — so needs a more careful read than a blanket removal),
   spacing/density across the busier pages (Overview now has 5 stat cards +
   3 charts), and the Servers/Keys tables' column density.

8. **A `recreated_from_key_id` audit trail for "reset usage."** Not urgent,
   but if a holder disputes a usage figure later, there's currently no link
   from the fresh key back to the one it replaced — the old key's history is
   just gone from the UI (soft-deleted in the DB, technically recoverable by
   an admin querying Postgres directly, but not exposed anywhere).
