# LightNode deployment: fleet-sg1

## Destination

- SSH alias: `fleet-sg1`
- IP: `130.94.43.251`
- User: `root`
- Local SSH identity: `~/.ssh/id_light_node`
- Deployment directory: `/opt/outline-manager`
- Public HTTP/HTTPS ports: 80 and 443

The owner authorized a fresh installation on 2026-10-23. The suspended
Lightsail instance's database is not being restored. The earlier candidate,
`public-sg2`, was abandoned because its port 443 belongs to an existing `sui`
service. That service must remain unchanged.

## DNS

Point these three A records at `130.94.43.251`, retaining DNS-only mode:

| Hostname | Purpose |
| --- | --- |
| `light-speed.invisigate.asia` | Dashboard |
| `light-speed-api.invisigate.asia` | API and Telegram webhook |
| `dynamic-access-light-speed.invisigate.asia` | Outline dynamic-access links |

Review any AAAA records so IPv6 clients do not reach an old destination.
The app uses one certificate covering all three hostnames, so all three must
reach this VM before requesting a certificate through HTTP-01 validation.
Do not change the separate `light-speed-data1` or `light-speed-data2` records
as part of this deployment.

## GitHub deployment settings

The workflow uses generic SSH and Docker; its existing secret names can stay.

| Secret | Value |
| --- | --- |
| `LIGHTSAIL_HOST` | `130.94.43.251` |
| `LIGHTSAIL_USER` | `root` |
| `LIGHTSAIL_SSH_KEY` | Entire private key from `~/.ssh/id_light_node` |
| `DEPLOY_ENV_FILE` | Existing production environment configuration |
| `TELEGRAM_*` | Existing bot configuration |

`LIGHTSAIL_SSH_PORT` defaults to 22; `DEPLOY_DIR` defaults to
`/opt/outline-manager`. The local alias and macOS Keychain settings are not
available on GitHub Actions runners. Never commit private keys or `.env`.

## First installation

1. Verify Docker, the Compose plugin, and rsync are installed. Verify ports
   80 and 443 are free and allowed through provider and host firewalls.
2. Create `/opt/outline-manager` and sync `deploy/` there. Deployment syncs
   exclude `.env` and `backups/`; `--delete` must not remove local backups.
3. Bootstrap TLS before the normal workflow starts nginx. With port 80 free,
   Certbot can issue a certificate using `certonly --standalone` directly into
   the `outline-manager_certbot_conf` Docker volume. Include all three domains
   listed above and use `light-speed.invisigate.asia` as the certificate name.
   This volume name assumes the default Compose project name from the
   deployment directory. Verify it if using `COMPOSE_PROJECT_NAME`.
4. Run the deployment workflow. It builds images, copies deployment files,
   writes `.env` from GitHub secrets, and starts the production stack.
   The PostgreSQL 18 backup client must match the PostgreSQL 18 server.
5. Check `docker compose ps`, validate nginx configuration, and test dashboard
   HTTPS, API health, login, and the restricted dynamic-access hostname.
   Verify webroot certificate renewal and a database backup after startup.

## Subsequent deployments and recovery

Use the workflow for redeployments. Local backup dumps live in
`/opt/outline-manager/backups`; they need an off-server copy to survive losing
this instance. See [README.md](README.md#backups) for backup and restore use.
Do not run `docker compose down -v` against data that must be retained.

## References

- [Docker volume backup and migration](https://docs.docker.com/engine/storage/volumes/#back-up-restore-or-migrate-data-volumes)
- [GitHub CLI secret input](https://cli.github.com/manual/gh_secret_set)
- [PostgreSQL dump compatibility](https://www.postgresql.org/docs/current/app-pgdump.html)
