# Build context is ./backend — the image contains the API only. The frontend is
# mounted (or copied) into /app/web separately, so a UI change doesn't require
# rebuilding the Go binary.

# --- build stage ---
FROM golang:1.25-bookworm AS builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# --- runtime stage ---
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Run unprivileged: the process only needs to read /app and talk to the network.
RUN useradd --create-home --uid 10001 app
USER app

WORKDIR /app
COPY --from=builder /out/server ./server

ENV PORT=8080 \
    STATIC_DIR=/app/web

EXPOSE 8080
ENTRYPOINT ["./server"]
