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
# COPY merges into an existing directory rather than replacing it, so the
# base image's own default page (index.html, 50x.html) would otherwise sit
# alongside our build output. Our build never produces a file literally
# named index.html (TanStack Start's SPA output is _shell.html), so that
# stock file — nginx's implicit `index` default — would silently keep
# being served instead of our app. Clear the directory first.
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /src/dist/client /usr/share/nginx/html

EXPOSE 80
