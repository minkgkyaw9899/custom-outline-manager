#!/usr/bin/env bash
# One-time bootstrap for the Let's Encrypt certificate this stack's nginx
# expects at /etc/letsencrypt/live/light-speed.invisigate.asia/. Run once
# from this directory after `docker compose up -d postgres api frontend`,
# before starting nginx for the first time.
#
# nginx refuses to start at all if a referenced ssl_certificate file is
# missing, so a self-signed placeholder is written first, nginx is started
# against that (enough to answer the ACME HTTP-01 challenge on :80), then
# it's swapped for the real cert and reloaded.
set -euo pipefail
cd "$(dirname "$0")"

PRIMARY_DOMAIN="light-speed.invisigate.asia"
DOMAINS=(
  "light-speed.invisigate.asia"
  "light-speed-api.invisigate.asia"
  "dynamic-access-light-speed.invisigate.asia"
)
: "${CERTBOT_EMAIL:?Set CERTBOT_EMAIL to the address Let's Encrypt should use for renewal notices}"

domain_args=()
for d in "${DOMAINS[@]}"; do
  domain_args+=(-d "$d")
done

echo "==> Checking for an existing certificate"
if docker compose run --rm --entrypoint sh certbot -c \
  "[ -f /etc/letsencrypt/live/$PRIMARY_DOMAIN/fullchain.pem ]"; then
  echo "Certificate already exists for $PRIMARY_DOMAIN — nothing to bootstrap."
  echo "(Delete the certbot_conf volume first if you need to reissue.)"
  exit 0
fi

echo "==> Creating a temporary self-signed certificate so nginx can start"
docker compose run --rm --entrypoint sh certbot -c "
  mkdir -p /etc/letsencrypt/live/$PRIMARY_DOMAIN && \
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$PRIMARY_DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$PRIMARY_DOMAIN/fullchain.pem \
    -subj '/CN=$PRIMARY_DOMAIN'
"

echo "==> Starting nginx"
docker compose up -d nginx

echo "==> Deleting temporary certificate"
docker compose run --rm --entrypoint sh certbot -c \
  "rm -rf /etc/letsencrypt/live/$PRIMARY_DOMAIN /etc/letsencrypt/archive/$PRIMARY_DOMAIN /etc/letsencrypt/renewal/$PRIMARY_DOMAIN.conf"

echo "==> Requesting the real certificate for: ${DOMAINS[*]}"
docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  "${domain_args[@]}" \
  --email "$CERTBOT_EMAIL" \
  --rsa-key-size 2048 \
  --agree-tos \
  --no-eff-email \
  --non-interactive

echo "==> Reloading nginx with the real certificate"
docker compose exec nginx nginx -s reload

echo "==> Done. The certbot service will keep the certificate renewed automatically."
