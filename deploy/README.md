# Deploying to a Lightsail instance

Single VM running Docker + Docker Compose, hosting Postgres, the API, the
frontend, and an edge nginx that TLS-terminates and routes three domains:

| Domain | Serves |
| --- | --- |
| `light-speed.invisigate.asia` | Dashboard UI (static SPA) |
| `light-speed-api.invisigate.asia` | Full REST API |
| `dynamic-access-light-speed.invisigate.asia` | Only `/api/v1/dkey/:token` — what Outline clients resolve `ssconf://` links against |

## One-time setup

1. **DNS**: point all three domains at the instance's static IP (A records,
   or AAAA if it has IPv6).
2. **Lightsail firewall**: open TCP 80 and 443 (Networking tab → IPv4
   Firewall). 80 is needed permanently, not just for the initial cert — it's
   where the ACME HTTP-01 challenge lands on every renewal.
3. Install Docker + the Compose plugin on the instance, then copy this
   `deploy/` directory to it (the CI workflow does this on every deploy; for
   the very first run, `scp -r deploy/ user@host:/opt/outline-manager`
   works too).
4. `.env` is written automatically by the GitHub Actions deploy workflow
   from the `DEPLOY_ENV_FILE` secret (see below) — trigger it once
   (`workflow_dispatch` or a push to `main`) before continuing, or for a
   fully manual first run, `cp .env.example .env` and fill in the blanks
   yourself (`JWT_SECRET` via `openssl rand -hex 32`, SMTP app password,
   etc.).
5. Bring up everything except nginx first, since nginx's config points at a
   certificate that doesn't exist yet:
   ```
   docker compose up -d postgres api frontend certbot
   ./init-letsencrypt.sh
   ```
   The script starts nginx itself partway through (against a throwaway
   self-signed cert, just long enough to answer the ACME challenge), then
   swaps in the real one and reloads.
6. Confirm all three domains load over HTTPS, then `docker compose ps` to
   confirm everything, including `certbot`, is `Up`. The `certbot` service
   renews automatically (checks every 12h; Let's Encrypt certs are valid 90
   days); nginx picks up a renewed cert on its own 12h reload loop, no manual
   step needed after that.

## Redeploying

`docker compose pull && docker compose up -d --remove-orphans` picks up new
`BACKEND_IMAGE`/`FRONTEND_IMAGE` tags. The GitHub Actions workflow
(`.github/workflows/deploy.yml`) does exactly this on every push to `main`
that touches `backend/`, `frontend/`, or `deploy/` — see that file for the
GitHub secrets it needs.

Config changes (`nginx/nginx.conf`, `docker-compose.yml` itself) also ship
through that same sync, since the workflow rsyncs this whole directory to the
server before pulling images. `.env` is excluded from that rsync and instead
written fresh on every deploy from the `DEPLOY_ENV_FILE` GitHub secret (whole
file contents, piped over SSH stdin — never interpolated into a shell
string). Update that secret and redeploy to change any runtime value
(`ALLOWED_ORIGINS`, `JWT_SECRET`, SMTP creds, ...); there's no reason to edit
`.env` on the server by hand anymore.

## Backups

The `backup` service (`prodrigestivill/postgres-backup-local`) runs `pg_dump`
once a day and writes gzipped dumps to `./backups` on the instance itself
(`deploy/backups/`, one file per run, auto-pruned to 7 daily / 4 weekly / 6
monthly copies — see `BACKUP_KEEP_*` in `docker-compose.yml`). This is
**host-local disk only**: it protects against DB corruption, a bad migration,
or an accidental `DELETE`, but *not* against losing the Lightsail instance
itself. Copying `./backups` off the instance periodically (e.g. to S3/Backblaze)
is a deliberately deferred next step, not something this covers today.

Trigger an ad-hoc dump outside the daily schedule:
```
docker compose exec backup /backup.sh
```

Restore (stop the API first so nothing writes during the restore):
```
docker compose stop api
gunzip -c backups/daily/outline_manager-<timestamp>.sql.gz | \
  docker compose exec -T postgres psql -U ${POSTGRES_USER:-outline} -d ${POSTGRES_DB:-outline_manager}
docker compose start api
```
