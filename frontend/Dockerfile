# Build context is ./frontend. Produces a self-contained static-file image —
# no Node/Bun at runtime, just nginx serving the built SPA.

# --- build stage ---
FROM oven/bun:1 AS builder
WORKDIR /src

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Vite inlines VITE_* vars into the bundle at build time, so the API's public
# URL has to be baked in here rather than passed at container start.
ARG VITE_API_URL=https://light-speed-api.invisigate.asia/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN bun run build

# --- runtime stage ---
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /src/dist/client /usr/share/nginx/html

EXPOSE 80
