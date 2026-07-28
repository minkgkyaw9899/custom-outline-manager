# Outline VPN Multi-Server Management — Architecture

## 1. Overview

A self-hosted control plane that manages access keys across multiple Outline
VPN servers, adding date-based expiration and data-quota enforcement that the
stock Outline Server (Shadowbox) API does not support natively.

The Outline Server API only understands a single absolute `dataLimit` (bytes)
per access key, applied cumulatively against the server's lifetime transfer
counter for that key. It has no concept of an expiry date, and no concept of
"renew/top-up" — you can only overwrite the limit. This service adds that
layer on top, in Postgres, and reconciles it against the real Outline servers
on a schedule and on-demand.

## 2. Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Go binary (single process)                │
│                                                                    │
│  ┌───────────────┐   ┌──────────────────┐   ┌──────────────────┐ │
│  │  HTTP API      │   │  Cron Scheduler   │   │  Outline Client  │ │
│  │  (Fiber router)│   │  (robfig/cron)     │   │  (per-server,    │ │
│  │  + static      │   │  every 30 min:     │   │   cert-pinned    │ │
│  │  dashboard     │   │  sync+enforce all  │   │   HTTPS)         │ │
│  └───────┬───────┘   │  servers            │   └────────┬─────────┘ │
│          │            └─────────┬──────────┘             │          │
│          │                      │                        │          │
│          └──────────┬───────────┴────────────────────────┘          │
│                     │                                                │
│              ┌──────▼───────┐                                       │
│              │ Repository    │                                      │
│              │ (pgx queries) │                                      │
│              └──────┬───────┘                                       │
└─────────────────────┼────────────────────────────────────────────────┘
                       │
                 ┌─────▼─────┐
                 │ PostgreSQL │
                 │ servers    │
                 │ keys       │
                 │ renewal_logs│
                 └───────────┘
```

Both the HTTP handlers and the cron job call the same
`internal/repository` + `internal/outline` + `internal/enforcement`
functions, so the reconciliation logic ("what should this key's Outline
state be, given DB state") lives in exactly one place
(`internal/enforcement.reconcileKey`, reached via `SyncServer` or
`ReconcileKeyByID`), whether triggered by the cron timer or by an immediate
action (create key, top-up, manual sync).

### Repository layout

```
backend/                  the Go API (its own module; `go test ./...` runs here)
  cmd/server/             entrypoint: config, DB, cron, router
  internal/config/        env var loading
  internal/db/            pgx pool + embedded SQL migrations
  internal/models/        domain types, status derivation, renewal math
  internal/outline/       cert-pinned Outline Server API client + client cache
  internal/repository/    all SQL, split per aggregate
  internal/enforcement/   the reconciler shared by cron and handlers
  internal/handlers/      Fiber handlers, middleware, static/SPA serving
  internal/cron/          scheduler wrapping enforcement.SyncServer
frontend/                 the UI, served as static files (React build lands here)
docs/                     this document
docker-compose.yml        postgres + backend; mounts frontend/ read-only
```

The backend never imports frontend code and the frontend only talks to the
JSON API under `/api`, so either side can be replaced independently — the UI
can be swapped for a React build without touching Go code.

## 3. Data model

### `servers`
| column        | type        | notes                                   |
|---------------|-------------|------------------------------------------|
| id            | uuid pk     |                                           |
| name          | text        | display label                            |
| api_url       | text        | Outline management API base URL (secret) |
| cert_sha256   | text        | pinned leaf-cert fingerprint (hex)       |
| last_synced_at| timestamptz | last successful metrics pull             |
| last_sync_error | text      | last error, if any, surfaced in UI       |
| deleted_at    | timestamptz null | soft-delete marker; NULL = active. See below |
| created_at / updated_at | timestamptz |                                |

`DELETE /servers/:id` archives rather than deletes the row: `keys`, `renewal_logs`
and `usage_snapshots` all cascade from `server_id`, so a hard delete would have
destroyed a holder's plan/expiry, renewal history, and usage charts right along
with it. Every normal read (`ListServers`, `GetServer`, the cron's
`ListAllServers`) filters `deleted_at IS NULL`, so an archived server is
invisible everywhere except the one place that looks for it: `POST /servers`
checks whether the submitted `apiUrl` matches an archived row before creating
anything. Same URL + same `certSha256` → the existing row is revived in place
(new name/cost/limits applied, `deleted_at` cleared, same `id` — so every key,
renewal and usage snapshot still hanging off that `id` comes back exactly as it
was). Same URL + a *different* cert → rejected as a validation error rather
than silently reused. An active (non-archived) row already at that URL → 409.
`api_url`'s uniqueness is therefore a partial index (`WHERE deleted_at IS
NULL`), not a plain column constraint — a truly decommissioned server's old
URL stays free for an unrelated new install.

### `keys`
| column               | type        | notes                                              |
|----------------------|-------------|-----------------------------------------------------|
| id                   | uuid pk     | internal id                                         |
| server_id            | uuid fk     | → servers.id                                        |
| outline_key_id       | text        | id on the Outline server (e.g. "0", "1")            |
| name                 | text        | key label                                           |
| access_url           | text        | `ss://...` connection string                        |
| port / method        | int / text  | denormalized from access_url for display            |
| password             | text        | plaintext Shadowsocks password, denormalized from Outline's create/list response for §8 |
| dynamic_token        | text        | opaque unique id for the key's `ssconf://` link (§8); stable for the key's lifetime |
| used_bytes           | bigint      | cumulative bytes, mirrors Outline's transfer metric |
| custom_limit_bytes   | bigint null | our enforced ceiling; NULL = unlimited               |
| end_date             | timestamptz null | NULL = no expiration                            |
| enabled              | boolean     | our last-known desired state (limit pushed to Outline)|
| status               | text        | derived: active / expired / limit_exceeded / disabled |
| created_at / updated_at | timestamptz |                                                    |

`status` is also computed live on read (see §5) so it's never stale between
cron runs; the stored column is a cache used for fast listing/filtering.

### `renewal_logs`
| column           | type        | notes                                |
|------------------|-------------|----------------------------------------|
| id               | uuid pk     |                                        |
| key_id           | uuid fk     | → keys.id                             |
| added_gb         | numeric     | 0 if only a date extension was applied |
| added_days       | int         | 0 if only a quota top-up was applied   |
| new_limit_bytes  | bigint null |                                        |
| new_end_date     | timestamptz null |                                   |
| created_at       | timestamptz |                                        |

## 4. Outline API integration

Each server is added with `apiUrl` + `certSha256` exactly as exported by the
Outline Manager "Share invite" flow, e.g.:

```json
{"apiUrl":"https://host:port/<secret-path>","certSha256":"<hex sha256 of leaf cert>"}
```

Because the management API is served over a self-signed cert, the client
cannot use normal CA validation. Instead (matching Outline Manager's own
behavior) we do TLS certificate pinning: `InsecureSkipVerify: true` plus a
custom `VerifyPeerCertificate` that recomputes SHA-256 over the leaf
certificate's raw DER and compares it against the stored `cert_sha256`. A
per-server `*http.Client` is cached (`internal/outline.ClientCache`) keyed by
server id so the pin is enforced on every call, and rotates automatically if
the operator updates a server's fingerprint.

Endpoints used:
- `GET  /access-keys` — list keys (id, name, password, port, method, accessUrl)
- `POST /access-keys` — create a key
- `PUT  /access-keys/{id}/name` — rename
- `DELETE /access-keys/{id}` — delete
- `GET  /metrics/transfer` — `{"bytesTransferredByUserId": {"<id>": <bytes>, ...}}`
- `PUT  /access-keys/{id}/data-limit` — `{"limit": {"bytes": N}}` set enforced ceiling
- `DELETE /access-keys/{id}/data-limit` — remove ceiling (unlimited)
- `GET  /server` — server metadata (name, id, version) for the "add server" health check

## 5. Status computation

For a given key, at read time or during reconciliation:

```
now_over_date  := end_date != null && now > end_date
now_over_quota := custom_limit_bytes != null && used_bytes >= custom_limit_bytes
should_be_enabled := !now_over_date && !now_over_quota

status :=
  if now_over_date  -> "expired"
  else if now_over_quota -> "limit_exceeded"
  else if !enabled  -> "disabled"        (manually disabled, not via date/quota)
  else -> "active"
```

`days_left` = `ceil((end_date - now) / 24h)`, floored at 0 once expired, and
null when there is no `end_date`. `remaining_bytes` =
`custom_limit_bytes - used_bytes` (null if no limit; floored at 0).

Both live in `models.DeriveKeyStatus`, which is the only place this is
computed — the API layer calls it through `Key.Enrich` on every read, and the
reconciler calls it to decide what to push to Outline.

## 6. Enforcement cron (every 30 minutes, also runnable on-demand)

For every server:
1. `GET /access-keys` + `GET /metrics/transfer`.
2. Upsert any keys found on Outline but missing in DB (adopts
   externally-created keys), update `used_bytes` for all known keys.
3. For every key, compute `should_be_enabled` (§5) and push the resulting
   limit to Outline *unconditionally*, not only on a state transition:
   - **Out of bounds**: `PUT /access-keys/{id}/data-limit {"limit":{"bytes":0}}`.
   - **In bounds, quota set**: `PUT .../data-limit {"limit":{"bytes": custom_limit_bytes}}`.
   - **In bounds, no quota**: `DELETE .../data-limit` (unlimited).

   Pushing every time is deliberate: a top-up changes `custom_limit_bytes`
   while the key stays enabled throughout, so a transition-only writer would
   never send the new ceiling. `enabled`/`status` in the DB are then updated
   only when they actually changed.
4. Update `last_synced_at` on the server row; record `last_sync_error` and
   continue with other servers on failure (one bad server never blocks the
   others — each gets its own 2-minute timeout).

This makes the cron idempotent and self-healing: it is the single source of
truth reconciler, so manual DB edits, API-triggered renewals, or a missed
30-minute cycle all converge to the correct Outline state on the next run.

## 7. Quota renewal / top-up math

Given a top-up request `{add_gb, add_days}` for a key:

```
new_limit_bytes = used_bytes + add_gb * 1e9                      // if add_gb > 0
new_end_date    = max(now, end_date ?? now) + add_days days       // if add_days > 0
```

The prior `custom_limit_bytes` is intentionally not an input: the new ceiling
is anchored to current usage. A dimension with a non-positive argument is left
untouched. Implemented in `models.RenewalTarget` and unit-tested there.

Rationale: because Outline's limit is cumulative-since-ever, naively setting
`custom_limit_bytes = add_gb * 1e9` would leave the user with *less* than
`add_gb` of fresh allowance (all prior usage already counts against it). Anchoring
the new ceiling to `used_bytes + add_gb*1e9` guarantees exactly `add_gb` of
fresh headroom regardless of history.

After computing the new values, the endpoint:
1. Writes `custom_limit_bytes` / `end_date` to the `keys` row.
2. Inserts a `renewal_logs` row (audit trail).
3. Immediately calls `enforcement.ReconcileKeyByID` for that one key so the
   Outline server reflects the change without waiting for the next cron tick
   (re-enables it and pushes the new data-limit).

## 8. Dynamic access keys

Every key's share link is a `ssconf://` [dynamic access
key](https://developer.getoutline.org/vpn/management/dynamic-access-keys)
pointing back at this server, not the raw static `ss://` link Outline itself
issued. An Outline client resolves `ssconf://host/path` by requesting
`https://host/path` and expecting a small JSON body back; we serve that at
`GET /api/v1/dkey/:dynamic_token`, unauthenticated (the token itself is the
credential, exactly like the password embedded in a static key — an Outline
client has no way to carry an admin session's JWT).

```
GET /api/v1/dkey/:dynamic_token
->  {"server": "<outline host>", "server_port": N, "password": "...", "method": "..."}
```

This bypasses the usual `{success, data, ...}` envelope entirely — the
response body has to be exactly the shape the client parses.

- `dynamic_token` is generated once (`authn.GenerateSlug`, 128 bits, same
  helper §"share-view" links use) when a key is first created or adopted, and
  never changes again, so the shared link keeps working even after a rename,
  a renewal, or a limit change.
- `password` is denormalized onto the `keys` row from Outline's
  create/list-access-keys response (`AccessURL` alone only carries it
  base64-encoded together with `method`). It is refreshed on every sync the
  same way `access_url`/`port`/`method` already were, so a key adopted before
  this feature shipped gets backfilled automatically on its next cron tick
  (or an immediate `POST /api/v1/servers/:id/sync`).
- A disabled, expired, or over-quota key still resolves successfully — the
  enforcement reconciler has already pushed a 0-byte data limit to Outline
  for it (§6), so the connection fails there. There is nothing extra to
  enforce at the dynamic-key layer, and the link starts working again the
  moment the key is renewed, with no new link to redistribute.
- Building the `ssconf://` link (`models.DynamicAccessURL`) requires knowing
  this server's own public host, which is not something a request can be
  trusted to self-report — it comes from the explicit `PUBLIC_BASE_URL`
  config value (empty by default). With it unset, `dynamicAccessUrl` on a key
  is `""` and the dashboard falls back to sharing the static `ss://` link, so
  the feature degrades gracefully rather than breaking key sharing outright.

## 9. REST API surface

All routes are versioned under `/api/v1`. Everything except `/auth/*` and `/health` requires a signed-in
admin session (email OTP → JWT in an httpOnly cookie; see [README.md](../README.md#authentication) for the
full auth flow and admin-management endpoints).

```
POST   /api/v1/auth/request-otp             {email} -> emails a 6-digit code
POST   /api/v1/auth/verify-otp              {email, code} -> sets session cookie
POST   /api/v1/auth/logout
GET    /api/v1/auth/me

GET    /api/v1/admins                       list admins
POST   /api/v1/admins                       add a non-root admin {email}
DELETE /api/v1/admins/:email                remove an admin (403 for the root admin)
PATCH  /api/v1/admins/:email/status         {status} (403 for the root admin)

POST   /api/v1/servers                      add a server {name, apiUrl, certSha256}; revives an
                                             archived match (§3) if apiUrl+certSha256 hit one
GET    /api/v1/servers                      list servers + aggregate usage
POST   /api/v1/servers/sync-all             sync every server concurrently, blocking until all
                                             finish (or perServerSyncTimeout each) — used by the
                                             fleet-wide "Sync now" affordances
GET    /api/v1/servers/:id                  server detail
GET    /api/v1/servers/:id/usage?from=&to=  bandwidth usage over a date range
DELETE /api/v1/servers/:id                  archive a server (soft delete, see §3) — its keys,
                                             renewal history and usage snapshots are kept, not
                                             deleted, in case the same server is added again
POST   /api/v1/servers/:id/sync             trigger immediate reconcile

POST   /api/v1/servers/:id/keys             create a key on that server
GET    /api/v1/keys                         list all keys w/ computed fields
GET    /api/v1/keys/:id                     key detail
DELETE /api/v1/keys/:id                     delete key (DB + Outline)
POST   /api/v1/keys/:id/renew               {add_gb, add_days} top-up/extend
GET    /api/v1/keys/:id/renewals            renewal log history for a key

GET    /api/v1/stats                        dashboard aggregate stats
GET    /api/v1/health                       liveness + database reachability (public)

GET    /api/v1/dkey/:dynamic_token          dynamic access key resolution (public, §8) — not
                                             called by this dashboard's own frontend, only by
                                             Outline client apps; bypasses the envelope below
```

Conventions across the surface:
- Every response, success or error, uses the same envelope:
  `{"success", "data"|"error", "message", "timestamp"}`. See
  [README.md](../README.md#response-envelope) for the full shape and error codes
  (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BAD_GATEWAY`,
  `INTERNAL_SERVER_ERROR`).
- Every key returned anywhere is enriched with live `status`, `daysLeft` and
  `remainingBytes`; collections always serialize as `[]`, never `null`.
- Validation failures carry per-field `error.details`, keyed by the exact JSON field name sent.
- `DELETE /api/v1/keys/:id` removes the key from Outline first and refuses (502)
  if that fails, so a key can't keep working after vanishing from the
  dashboard. `?force=true` overrides, dropping only the local record.
- Unknown paths under `/api/` return a standardized JSON 404; every other unknown path
  falls through to the frontend's `index.html` (client-side routing).

## 10. Frontend

The UI is a separate deliverable in `frontend/`, decoupled from the Go module.
The backend serves whatever static directory `STATIC_DIR` points at, with an
`index.html` fallback for unmatched paths so client-side routes survive a hard
refresh. Nothing in the API assumes a particular framework.

`frontend/` has not been built yet. See [docs/FRONTEND_HANDOFF.md](FRONTEND_HANDOFF.md) for the full spec
(API reference, TypeScript types, theme, screens) to build it — a TanStack Start + shadcn/ui app, built to
`frontend/dist`/`frontend` and pointed at by `FRONTEND_DIR`/`STATIC_DIR`.

During development the frontend can instead run on its own origin (Vite on
`:5173`) and call the API cross-origin; set `ALLOWED_ORIGINS=http://localhost:5173`
so the CORS middleware (`handlers.CORS`) emits the matching headers. Left
empty, no CORS headers are sent, which is the correct posture for the
same-origin production setup.

## 11. Deployment

Two independent images, each with its own multi-stage Dockerfile:

- `backend/Dockerfile`: `golang:1.25` builder → `debian:bookworm-slim`
  runtime, non-root user. Runs DB migrations automatically on boot
  (`internal/db.Migrate`), then the HTTP server and the cron scheduler in the
  same process, shutting both down gracefully on SIGTERM (10s grace for
  in-flight requests; in-flight syncs are cancelled).
- `frontend/Dockerfile`: `oven/bun` builder (`VITE_API_URL` baked in as a
  build arg, since Vite inlines it at build time) → `nginx:alpine` runtime
  serving the static SPA build, with `/assets/*` cached immutably and
  everything else falling back to the prerendered SPA shell for client-side
  routing.

Root `docker-compose.yml` is for local dev only (single origin: backend
serves the frontend directly via `STATIC_DIR`/`FRONTEND_DIR`, or the frontend
runs on its own Vite dev server with `ALLOWED_ORIGINS` set for cross-origin
calls).

Production deploys both containers on one host behind a shared edge nginx —
see [deploy/README.md](../deploy/README.md). That stack splits the surface
across three subdomains (dashboard UI, full API, and a
dynamic-access-key-only host for `ssconf://` links, kept separate from the
API domain so a shared link never reveals it), TLS via Let's Encrypt/certbot,
and is what `.github/workflows/deploy.yml` builds, pushes to GHCR, and
rsyncs/redeploys on every push to `main`.
