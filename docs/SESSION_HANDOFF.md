# Session Handoff — next feature: Admin management

Read `docs/FRONTEND_HANDOFF.md` first for the API contract (envelope, endpoints, types). This file only
records what changed / what is verified, so the next session doesn't re-verify finished work.

## Status

| Feature | State |
| --- | --- |
| Project scaffold, theme, fonts, app shell (sidebar + theme toggle) | done |
| API client (`src/lib/api.ts`), types, query options, form-error binding | done |
| **Auth: `/login` → `/verify-otp` → session → logout** | **done, verified live against the backend** |
| Dashboard overview (`/_authed/`) | built, renders live data, not systematically failure-tested |
| Admin management (`/admins`) | **not started — next up** |
| Servers list / server detail | not started (sidebar already links `/servers`, route missing → 404) |
| Key detail | not started |

## What was verified this session (real backend, real browser, no mocks)

Backend in Docker on `:8080`, Vite dev on `:3000`, `ALLOWED_ORIGINS=http://localhost:3000` added to `.env`.

1. Unauthenticated `/` → redirects to `/login` (`_authed` `beforeLoad` guard). ✅
2. Unregistered email → inline field error under the input, no toast ("This email is not a registered
   admin"), i.e. `error.details` → TanStack Form binding works. ✅
3. Registered root email → `POST /auth/request-otp` 200 (takes ~4s, real Gmail SMTP), navigates to
   `/verify-otp?email=…&expiresIn=600`, countdown renders and ticks, resend button disabled until 0. ✅
4. Wrong code → inline "Incorrect code" under the code input. ✅
5. Correct code → `auth_token` cookie set, `/auth/me` cached, lands on dashboard with live stats. ✅
6. Full page reload while signed in → session bootstraps from cookie, stays on dashboard. ✅
7. Logout → cookie cleared, redirect to `/login`; navigating back to `/` redirects to `/login` again. ✅
8. `/verify-otp` opened directly without an `email` search param → redirects to `/login`. ✅

Not exercised (same code path as #4, differ only in server message): OTP expired, "too many incorrect
attempts" (`OTP_MAX_ATTEMPTS=5`), resend after the 10-minute countdown reaches zero.

Note: an invalid-format email never reaches the API — `<input type="email">` native validation blocks the
submit. That's intended; the backend's format validation is the second line of defence.

## Getting the OTP without opening the mailbox

Codes are stored as plain SHA-256 of the 6 digits, so a brute-force over 10^6 candidates recovers the code
instantly — this is how the flow was tested end-to-end:

```bash
H=$(docker compose exec -T postgres psql -U outline -d outline_manager -tAc "select code_hash from otp_codes where consumed_at is null order by created_at desc limit 1") && python3 -c "
import hashlib,sys
h=sys.argv[1].strip()
for i in range(1000000):
    c='%06d'%i
    if hashlib.sha256(c.encode()).hexdigest()==h: print(c); break
" "$H"
```

## Dev loop

```bash
docker compose up -d --build backend   # reads ../.env, includes ALLOWED_ORIGINS + SMTP creds
cd frontend && bun run dev             # :3000, VITE_API_URL=http://localhost:8080/api/v1 in frontend/.env
```

Don't `source ../.env` in a shell — `SMTP_PASSWORD` contains spaces and the shell chokes on it (exit 127).
Docker Compose parses it correctly; that's why the backend runs in the container.

## Conventions already established — follow them, don't invent new ones

- Data fetching: `queryOptions` factories live in `src/lib/queries.ts` (`adminsQueryOptions` already exists
  and is unused — wire it up). Mutations use `useMutation` + `queryClient.invalidateQueries`.
- Requests go through `apiClient` (`get/post/patch/delete` in `src/lib/api.ts`), which unwraps the
  `{success, data}` envelope, toasts `message` on success and non-field errors on failure, and redirects to
  `/login` on `UNAUTHORIZED`. Paths are relative, no leading slash: `apiClient.get("admins")`.
- Forms: TanStack Form + `applyServerFieldErrors(form, error.apiError.details)` inside the `catch` of
  `onSubmit`, guarded by `isApiError(error)`. Copy the pattern from `src/routes/login.tsx`.
- Protected pages are file-routes named `_authed.<name>.tsx` (flat, dot-separated), rendered inside
  `AppLayout`. `src/components/` already has `confirm-dialog.tsx`, `copy-button.tsx`, `status-badge.tsx`.
- `bun run typecheck` is clean and must stay clean. `bun run lint` reports 16 errors — all in generated
  shadcn `src/components/ui/*` files plus `_authed.index.tsx`; not introduced by auth code. Either leave
  them or clean them in a dedicated pass, but don't add new ones.

## Next feature: Admin management (`/admins`)

Route file: `src/routes/_authed.admins.tsx` (the sidebar already links to `/admins`).

- Table from `GET /admins` → `AdminUser[]` (columns: email, status badge, created, actions).
- Rows with `isRoot: true`: show an "immutable"/"root" badge, hide or disable delete and the status toggle.
  Don't hardcode the email — the API tells you.
- "Add admin" dialog: email only → `POST /admins {email}` → 201. Duplicate email returns 422 with a field
  error on `email` — bind it inline, don't toast.
- Delete: `DELETE /admins/:email` (URL-encode the email segment). Use `ConfirmDialog`. Root → 403.
- Status toggle: `PATCH /admins/:email/status {status: "active"|"suspended"}`. Root → 403.
- Invalidate `["admins"]` after every mutation.

Failure cases to actually test in the browser before calling it done: duplicate email (422 inline),
delete/suspend attempt on the root row (should be impossible from the UI; verify the API's 403 surfaces as
a toast if it ever fires), suspended admin cannot log in (suspend a second admin, then run the login flow
for it — expect a field error on the email input), and empty-list state.
