# Outline Fleet Manager

A self-hosted control plane for managing access keys across multiple Outline
VPN servers, adding date-based expiration and data-quota enforcement on top
of the stock Outline Server API (which only supports a raw byte ceiling with
no concept of expiry or "renewal").

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design:
data model, Outline API integration, the enforcement cron, and the quota
top-up/date-extension math.

> **Admin auth is email-OTP based.** Every endpoint under `/api/v1` except
> `/api/v1/health` and `/api/v1/auth/*` requires a signed-in admin session
> (see [Authentication](#authentication) below).

## Layout

```
backend/     Go API + enforcement cron (its own Go module)
frontend/    the UI, served as static files
docs/        architecture doc
```

The two halves only meet over the JSON API under `/api`, so the frontend can
be replaced (React build, separate host, whatever) without touching Go code.

## Quick start (Docker)

```bash
cp .env.example .env && docker compose up --build
```

The dashboard is served at `http://localhost:8080`. On first boot the backend
runs its own DB migrations against the `postgres` service automatically.

Add your first server from the UI ("+ Add Server"), or via curl:

```bash
curl -X POST http://localhost:8080/api/servers -H 'Content-Type: application/json' -d '{"name":"my-server","apiUrl":"https://host:port/secret-path","certSha256":"<fingerprint>"}'
```

The value pasted into the UI's "paste JSON" box can be exactly what Outline
Manager's "Share invite" / "Add server" flow gives you:
`{"apiUrl":"...","certSha256":"..."}`.

## Local development

### Backend

Requires Go 1.25+ and a reachable Postgres instance.

```bash
cd backend && DATABASE_URL="postgres://outline:outline@localhost:5432/outline_manager?sslmode=disable" go run ./cmd/server
```

```bash
cd backend && go test ./...
```

Environment variables (all optional except `DATABASE_URL`):

| Variable               | Default                        | Purpose                                          |
|------------------------|---------------------------------|--------------------------------------------------|
| `DATABASE_URL`         | —                                | Postgres connection string (required)            |
| `PORT`                 | `8080`                           | HTTP listen port                                 |
| `STATIC_DIR`           | `../frontend`                    | Directory served as the UI                       |
| `ALLOWED_ORIGINS`      | *(empty)*                        | Comma-separated CORS origins for a separate UI, credentials-enabled |
| `PUBLIC_BASE_URL`      | *(empty)*                        | This server's own public host[:port] (e.g. `vpn.example.com`), scheme optional. Enables `ssconf://` dynamic access key links (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#8-dynamic-access-keys)); unset means keys are shared as static `ss://` links instead |
| `CRON_INTERVAL`        | `30m`                            | Enforcement sync interval                        |
| `REQUEST_TIMEOUT`      | `15s`                            | Per-request deadline (DB + Outline calls included)|
| `OUTLINE_HTTP_TIMEOUT` | `10s`                            | Timeout for calls to Outline servers             |
| `ROOT_ADMIN_EMAIL`     | `minkgkyaw9899@gmail.com`        | Immutable super-admin; seeded on first migration |
| `JWT_SECRET`           | *(random on boot if unset)*      | Signs session JWTs — set explicitly in production or sessions reset on every restart |
| `JWT_TTL`              | `168h` (7d)                      | Session lifetime                                 |
| `OTP_TTL`               | `10m`                            | How long a login code is valid                   |
| `OTP_MAX_ATTEMPTS`     | `5`                               | Incorrect attempts allowed before a code is locked out |
| `COOKIE_SECURE`        | `false`                           | Set `true` once served over HTTPS                |
| `COOKIE_DOMAIN`        | *(empty)*                        | Cookie `Domain` attribute, if needed              |
| `SMTP_HOST`            | `smtp.gmail.com`                 | OTP email delivery                                |
| `SMTP_PORT`            | `587`                            | STARTTLS port                                     |
| `SMTP_USERNAME`        | `minkgkyaw1999@gmail.com`        | SMTP auth username                                |
| `SMTP_PASSWORD`        | —                                 | SMTP auth password (Gmail: use an App Password)   |
| `SMTP_FROM_EMAIL`      | `minkgkyaw1999@gmail.com`        | `From` address on OTP emails                      |
| `SMTP_FROM_NAME`       | `Invisigate VPN`            | `From` display name                               |
| `SMTP_TIMEOUT`         | `10s`                             | Bounds the whole send so a stalled connection fails fast instead of hanging |

## Authentication

Passwordless, email-OTP based. No passwords are stored.

```
POST /api/v1/auth/request-otp   {email}          -> emails a 6-digit code, 10 min TTL
POST /api/v1/auth/verify-otp    {email, code}     -> sets an httpOnly session cookie + returns {admin, token}
POST /api/v1/auth/logout                          -> clears the session cookie
GET  /api/v1/auth/me                               -> current admin (requires session)
```

The email must already exist in `admin_users` — there is no self-service sign-up. The **root admin**
(`ROOT_ADMIN_EMAIL`, default `minkgkyaw9899@gmail.com`) is seeded by migration `0002_auth.up.sql` and is
immutable: `DELETE /api/v1/admins/:email` and `PATCH /api/v1/admins/:email/status` both return
`403 FORBIDDEN` for that address, regardless of who's asking.

```
GET    /api/v1/admins                     list admins (isRoot computed per row)
POST   /api/v1/admins            {email}  add a non-root admin
DELETE /api/v1/admins/:email               remove an admin (403 for root)
PATCH  /api/v1/admins/:email/status {status: "active"|"suspended"}  (403 for root)
```

Sessions ride on an httpOnly `auth_token` cookie (`SameSite=Lax`); non-browser clients may instead send
`Authorization: Bearer <token>` using the `token` returned from `verify-otp`.

### Frontend

`frontend/` currently holds a dependency-free HTML/CSS/JS dashboard; the
backend serves it directly, so there is no build step.

When the React app replaces it, either:

- **build and let the backend serve it** — point `FRONTEND_DIR=./frontend/dist`
  (compose) or `STATIC_DIR=../frontend/dist` (local) at the build output; the
  server falls back to `index.html` for unmatched paths, so client-side routing
  works on a hard refresh; or
- **run the dev server on its own origin** — set
  `ALLOWED_ORIGINS=http://localhost:3000` so the API accepts cross-origin
  calls (with credentials, for the auth cookie), or proxy `/api` and skip
  CORS entirely.

## REST API

All endpoints are versioned under `/api/v1`. See [Authentication](#authentication)
above for the auth endpoints. Everything below requires a signed-in session.

```
GET    /api/v1/servers                         list servers + aggregate usage
POST   /api/v1/servers                         add a server {name, apiUrl, certSha256, costUsdPerMonth, maxKeys, defaultLimitGb}
GET    /api/v1/servers/:id                     server detail + its keys
GET    /api/v1/servers/:id/usage?from=&to=     bandwidth usage over a date range (RFC3339)
PATCH  /api/v1/servers/:id/config              edit {name, costUsdPerMonth, maxKeys, clearMaxKeys, hostnameForAccessKeys}
PATCH  /api/v1/servers/:id/default-limit       set the overall data limit {limit_gb, apply_to_unlimited, clear_default}
DELETE /api/v1/servers/:id                     remove a server from the dashboard
POST   /api/v1/servers/:id/sync                trigger an immediate reconcile

POST   /api/v1/servers/:id/keys                create a key {name, add_gb, add_days, user_id}
GET    /api/v1/keys[?unassigned=true]          list all keys, or only those with no holder
GET    /api/v1/keys/:id                        key detail
PATCH  /api/v1/keys/:id                        absolute edit {name, limit_gb, end_date}
DELETE /api/v1/keys/:id[?force=true]           delete a key (Outline + DB)
POST   /api/v1/keys/:id/renew                  top-up/extend {add_gb, add_days}
GET    /api/v1/keys/:id/renewals               renewal audit log for a key
GET    /api/v1/keys/:id/daily                  the key's traffic series

GET    /api/v1/users                           list key holders + their primary key
POST   /api/v1/users                           add a holder {name, note, status} (+ serverId to provision a key too)
GET    /api/v1/users/:id                       holder detail + all their keys
PATCH  /api/v1/users/:id                       edit {name, note, status}
DELETE /api/v1/users/:id                       remove a holder (their keys survive, unassigned)
POST   /api/v1/users/:id/keys                  give them another key {serverId, name, add_gb, add_days}
POST   /api/v1/users/:id/keys/link             adopt an existing key {keyId}
POST   /api/v1/users/:id/keys/replace          move them to a new key {serverId, ...}; the old one is unlinked, not deleted
PATCH  /api/v1/users/:id/primary-key           point their link at another key they hold {keyId}
DELETE /api/v1/users/:id/keys/:keyId           unlink a key without deleting it
POST   /api/v1/users/:id/share                 get-or-create their share link
POST   /api/v1/users/:id/share/reset           clear their share passcode

GET    /api/v1/stats                           dashboard aggregate stats
```

### Users, keys, and the links a holder receives

A **user** is the person a key is handed to; a key is an implementation detail
behind them. Two things belong to the user rather than the key, so that
re-provisioning someone is invisible from their side:

- the **ssconf:// dynamic access link**, which resolves through
  `GET /api/v1/dkey/:token` to whichever key is currently their *primary*, and
- the **share link** (`/users/keys-status/:slug`), the passcode-gated status
  page — the passcode they set survives a key swap too.

`POST /users/:id/keys/replace` creates a key on the chosen server, points the
holder at it, and **unlinks** their previous key rather than deleting it: it
keeps working on its Outline server and keeps its usage history until deleted
explicitly. Keys issued before this model still resolve by their own token, so
links already handed out keep working.

`maxKeys` caps key creation per server (409 once reached, never retroactive —
lowering it below the current count blocks new keys rather than deleting any),
and `defaultLimitBytes` is the quota new keys start on. Setting it with
`apply_to_unlimited` also brings existing *unlimited* keys onto that figure;
keys that already carry a ceiling are never touched, so an individually
negotiated allowance survives a change to the server default.

### Response envelope

Every response — success or error, every endpoint including `/health` and `/auth/*` — uses the same shape:

```json
// success
{"success": true, "data": {...}, "message": "...", "timestamp": "2026-07-25T15:30:00Z"}
// error
{"success": false, "error": {"code": "VALIDATION_ERROR", "message": "...", "details": [{"field": "email", "message": "..."}]}, "timestamp": "..."}
```

`error.code` is one of `VALIDATION_ERROR` (422), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`CONFLICT` (409), `BAD_GATEWAY` (502, an unreachable Outline server), `INTERNAL_SERVER_ERROR` (500/503).
`error.details` is only populated for `VALIDATION_ERROR` and maps 1:1 to invalid request-body fields, keyed
by the same JSON field name the client sent — bind it directly to form field errors. Key collections always
serialize as an array (`data: []`, never `null`), and every key carries live `status`, `daysLeft` and
`remainingBytes`.

`add_gb` on `/renew` is a **relative top-up**: the new ceiling is
`current_used_bytes + add_gb * 1e9`, guaranteeing a fresh `add_gb` of
headroom regardless of prior usage. `add_days` extends `end_date` by that
many days from `max(now, current_end_date)`.

Deleting a key removes it from the Outline server first and fails with `502`
if that can't be done — otherwise the key would keep working while
disappearing from the dashboard. `?force=true` drops the local record anyway.

## Enforcement model

A background job runs every `CRON_INTERVAL` (default 30 min) per server:
pulls `/access-keys` + `/metrics/transfer`, updates usage in Postgres, then
pushes each key's desired data limit to Outline — `{"bytes":0}` for any key
where `now > end_date` or `used_bytes >= custom_limit_bytes`, the current
ceiling otherwise. Keys that come back into bounds (via a renewal, or because
their limit/date was raised) are re-enabled on the same pass. The same
reconciler runs synchronously right after key creation and renewal, so changes
take effect immediately rather than waiting for the next tick.
