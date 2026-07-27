# Frontend Handoff

> **Partly superseded.** The design changed after this was written. The "Theme spec", "Screens to build",
> and "Suggested routes" sections below describe the *old* design — see `DESIGN_HANDOFF.md` for the current
> one. Everything else here (response envelope, ky client, auth flow, endpoints, TypeScript types) is still
> accurate. Also note the opening claim that `frontend/` is empty is now stale: auth, the app shell, and the
> Overview page are built.

Backend is complete, tested, and running (`docker compose up --build` works end-to-end). This doc is
everything the next session needs to build `frontend/` from scratch without re-reading the Go source.

**Frontend has not been started.** `frontend/` is currently empty (Docker auto-created it as a bind-mount
point during backend testing this session — nothing in it to preserve or reuse). Build straight into it.

## What's already true, don't re-decide it

- Backend lives in `backend/` (Go, Fiber v3, Postgres via pgx). Fully standardized on the envelope below.
  All routes are versioned under `/api/v1`. Every route except `/api/v1/health` and `/api/v1/auth/*`
  requires a session (httpOnly cookie `auth_token`, `SameSite=Lax`).
- Root admin is `minkgkyaw9899@gmail.com` (env `ROOT_ADMIN_EMAIL`), seeded automatically by migration.
  It cannot be deleted or have its status changed — the API returns `403 FORBIDDEN` for both. The
  frontend's job is purely cosmetic here: hide/disable the delete button and show an "immutable" badge
  for whichever row has `isRoot: true` — don't hardcode the email, the API tells you.
- OTP email delivery needs a real `SMTP_PASSWORD` (Gmail App Password) in `.env` to actually send mail;
  without it `request-otp` returns a `502 BAD_GATEWAY`. That's a deployment/ops step, not a frontend concern.
- Key top-up math (`add_gb`/`add_days`) is implemented and verified live against a running server — see
  README "REST API" section. Frontend just needs a form with those two fields; don't reimplement the math.
- I could not fetch your claude.ai/design link (no authenticated browser session available in this
  environment — Claude in Chrome extension wasn't connected). The theme preset (`b1yjJqjUaO` via the
  shadcn CLI) gets you the actual design tokens without needing the page. Screen layout should follow the
  written spec below; if the design link still matters, view it yourself and paste in any deltas next
  session, or add screenshots for the next session to work from.

## Response envelope (every endpoint, no exceptions)

```json
// success
{"success": true, "data": {...}, "message": "human string, may be empty", "timestamp": "2026-07-25T15:30:00Z"}

// error
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid",
    "details": [{"field": "email", "message": "Must be a valid email address"}]
  },
  "timestamp": "2026-07-25T15:30:00Z"
}
```

- `error.code` ∈ `VALIDATION_ERROR` (422) · `UNAUTHORIZED` (401) · `FORBIDDEN` (403) · `NOT_FOUND` (404) ·
  `CONFLICT` (409) · `BAD_GATEWAY` (502) · `INTERNAL_SERVER_ERROR` (500/503).
- `details[].field` is the exact JSON field name from the request body you sent (e.g. `apiUrl`, not
  `APIURL`) — map it straight to TanStack Form field state.
- `details` is only ever present on `VALIDATION_ERROR`. Global (non-field) errors just use `error.message`
  — show that as a Sonner toast.
- Successful list endpoints always return `data: []`, never `null`.
- HTTP status still matters (ky/fetch throw on non-2xx) — don't rely on `success` alone to detect failure.

## ky client sketch

```ts
import ky from "ky";
import { toast } from "sonner";

export const api = ky.create({
  prefixUrl: import.meta.env.VITE_API_URL ?? "/api/v1",
  credentials: "include", // required: session rides on the auth_token cookie
  hooks: {
    afterResponse: [
      async (_req, _opts, response) => {
        const body = await response.clone().json().catch(() => null);
        if (body?.success && body.message) toast.success(body.message);
        return response;
      },
    ],
    beforeError: [
      async (error) => {
        const body = await error.response?.clone().json().catch(() => null);
        if (body?.error) {
          if (!body.error.details?.length) toast.error(body.error.message);
          error.apiError = body.error; // attach for field-error binding; augment ky's HTTPError type
          if (body.error.code === "UNAUTHORIZED") {
            // redirect to /login — session expired or was never established
          }
        }
        return error;
      },
    ],
  },
});
```

Bind `error.apiError.details` to TanStack Form: on submit catch, `for (const d of details) form.setFieldMeta(d.field, ...)` or the equivalent field-error API for whichever TanStack Form version you install.

## Auth flow

```
POST /api/v1/auth/request-otp   {email}            -> {email, expiresInSeconds}   (also: sets nothing, no cookie yet)
POST /api/v1/auth/verify-otp    {email, code}       -> {admin, token}             (sets auth_token cookie)
POST /api/v1/auth/logout                             -> null                       (clears cookie)
GET  /api/v1/auth/me                                  -> AdminUser                 (401 if not signed in — use this to bootstrap session state on app load)
```

- `code` is always 6 digits, OTP TTL is `OTP_TTL` (default 10 min) — use `expiresInSeconds` from
  `request-otp`'s response to drive the resend-timer countdown on the OTP screen.
- Field errors from `request-otp`: `{field: "email", message: "This email is not a registered admin"}` —
  show inline under the email input, this is the expected path for someone typing an email that was never
  added as an admin (no self-service signup).
- Field errors from `verify-otp`: all keyed on `field: "code"` — `"No active code..."`, `"...expired..."`,
  `"Too many incorrect attempts..."`, `"Incorrect code"`. Show inline under the OTP input.
- `admin.isRoot: boolean` — computed server-side, trust it over any local check.
- On 401 from any protected call, redirect to `/login`. Don't try to silently refresh; there's no refresh
  token, sessions just last `JWT_TTL` (default 7d) and re-auth via OTP again after that.

## Admin management

```
GET    /api/v1/admins                                 -> AdminUser[]
POST   /api/v1/admins            {email}               -> AdminUser (201)   422 if email already an admin
DELETE /api/v1/admins/:email                           -> null              403 FORBIDDEN if email is root
PATCH  /api/v1/admins/:email/status  {status: "active"|"suspended"}  -> null   403 FORBIDDEN if email is root
```

`:email` is a raw path segment (e.g. `/admins/someone@example.com`) — URL-encode it when building the request URL, the backend unescapes defensively either way.

## Servers

```
GET    /api/v1/servers                          -> ServerWithUsage[]
POST   /api/v1/servers   {name, apiUrl, certSha256}  -> Server (201)
                          422 field errors on: name, apiUrl (validates format AND live-connects to the
                          Outline server before saving — a wrong cert/URL fails here, not silently later)
GET    /api/v1/servers/:id                      -> {server: Server, keys: Key[]}
DELETE /api/v1/servers/:id                      -> null
POST   /api/v1/servers/:id/sync                 -> {status: "synced"}   502 if Outline unreachable
GET    /api/v1/servers/:id/usage?from=&to=      -> {serverId, from, to, bytesUsed}   (RFC3339 timestamps; from/to optional, defaults to last 30 days)
POST   /api/v1/servers/:id/keys  {name?, add_gb?, add_days?}  -> Key (201)   empty body allowed = key with no quota/expiry
```

`createServer` really does synchronously call the Outline server to validate reachability before saving —
expect that POST to take a second or two; show a loading state, not just a spinner-less button.

## Keys

```
GET    /api/v1/keys                              -> Key[]   (all keys across all servers, includes serverName)
GET    /api/v1/keys/:id                          -> Key
DELETE /api/v1/keys/:id[?force=true]             -> null    502 if Outline unreachable and not forced
POST   /api/v1/keys/:id/renew   {add_gb?, add_days?}  -> {key: Key, renewal: RenewalLog}   422 if both are ≤0
GET    /api/v1/keys/:id/renewals                 -> RenewalLog[]   (newest first)
```

Renewal math (already implemented, just for context on what the two inputs mean):
`add_gb` → `new_limit_bytes = used_bytes + add_gb * 1e9` (relative top-up: always gives a fresh `add_gb`
of headroom regardless of prior usage). `add_days` → `new_end_date = max(now, current_end_date) + add_days`
(extending early never wastes remaining time). Renewal modal should have two independent optional number
inputs, "Add GB" and "Add Days" — at least one must be > 0.

## Stats

```
GET /api/v1/stats -> DashboardStats
```

## TypeScript types (mirror the Go JSON tags exactly)

```ts
type AdminStatus = "active" | "suspended";
interface AdminUser {
  id: string; email: string; status: AdminStatus; isRoot: boolean;
  createdAt: string; updatedAt: string;
}

type KeyStatus = "active" | "expired" | "limit_exceeded" | "disabled";
interface Key {
  id: string; serverId: string; outlineKeyId: string; name: string; accessUrl: string;
  port: number | null; method: string | null;
  usedBytes: number; customLimitBytes: number | null; endDate: string | null;
  enabled: boolean; status: KeyStatus;
  createdAt: string; updatedAt: string;
  daysLeft: number | null; remainingBytes: number | null; serverName?: string;
}

interface Server {
  id: string; name: string; apiUrl: string; certSha256: string;
  lastSyncedAt: string | null; lastSyncError: string | null;
  createdAt: string; updatedAt: string;
}
interface ServerWithUsage extends Server {
  keyCount: number; activeKeys: number; totalUsedBytes: number;
}

interface RenewalLog {
  id: string; keyId: string; addedGb: number; addedDays: number;
  newLimitBytes: number | null; newEndDate: string | null; createdAt: string;
}

interface DashboardStats {
  totalServers: number; totalKeys: number; activeKeys: number;
  expiredKeys: number; limitExceededKeys: number; combinedUsedBytes: number;
}
```

`usedBytes`/`customLimitBytes`/`remainingBytes`/`combinedUsedBytes` are all raw bytes (decimal GB = 1e9,
not 2^30) — format with that conversion for display, and note `BytesPerGB = 1_000_000_000` matches what
the backend uses for `add_gb` math, so round-tripping GB↔bytes in the UI stays consistent with the server.

## Theme spec (unchanged from original ask)

- `bunx --bun shadcn@latest init --preset b1yjJqjUaO --template start --pointer` inside `frontend/` —
  this pulls the actual design tokens for the preset directly, no need for the design-page screenshot.
- Base color: Neutral. Accent: Emerald (`#059669` / `#10B981`). Light + dark mode with a toggle.
- Fonts: headings in Lora, body in Figtree — wire into `tailwind.config` font families.
- ky + TanStack Query for data fetching, Sonner for toasts (see client sketch above), TanStack Form for
  all forms with field-error binding to `error.details`.

## Screens to build

1. **Auth**: email login (single input, "Send code" button) → OTP verify (6-digit input, resend timer
   driven by `expiresInSeconds`, field error surfaced under the code input).
2. **Overview dashboard**: metric cards from `GET /stats` (total active keys, connected servers, aggregate
   bandwidth), emerald bar/area chart of usage over time (per-server usage endpoint, or aggregate client-side).
3. **Admin management**: table from `GET /admins`, immutable badge + hidden delete on `isRoot: true` rows,
   "Add Admin" modal (email only, 422 on duplicate).
4. **Servers list**: cards/table from `GET /servers`, "Add Server" modal (name, apiUrl, certSha256 — expect
   the request to take a couple seconds and to fail with field errors on bad connection info).
5. **Server detail** (`/servers/:serverId`): `GET /servers/:id` → server info + its keys table (reuse the
   keys table component, scoped).
6. **Key detail** (`/keys/:keyId`): `GET /keys/:id` for the header (usage progress bar from
   `usedBytes`/`customLimitBytes`, `daysLeft` countdown, copy `accessUrl` button), renewal modal (add_gb/add_days
   → `POST /keys/:id/renew`), audit log table from `GET /keys/:id/renewals`.

## Suggested routes (TanStack Start / file-based router)

```
/login
/verify-otp
/                     (dashboard overview, protected)
/admins               (protected)
/servers              (protected)
/servers/$serverId    (protected)
/keys/$keyId          (protected)
```

Gate protected routes on `GET /auth/me` succeeding (loader/beforeLoad); redirect to `/login` on 401.

## Local dev loop

```bash
docker compose up -d postgres
cd backend && DATABASE_URL="postgres://outline:change-me@localhost:5432/outline_manager?sslmode=disable" JWT_SECRET=dev-secret go run ./cmd/server
# separately, once frontend/ exists:
cd frontend && bun run dev   # point VITE_API_URL / equivalent at http://localhost:8080/api/v1
```

Set `ALLOWED_ORIGINS=http://localhost:<frontend-port>` (backend env) so the dev-server origin can call the
API with credentials.
