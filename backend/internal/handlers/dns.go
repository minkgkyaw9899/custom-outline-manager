package handlers

import (
	"context"
	"net"
	"time"
)

// resolveIP returns the IP address a host currently resolves to, so a
// domain-based server can hand clients a direct IP instead of making them
// pay for a DNS lookup on every connection. If host is already a literal IP,
// it's returned as-is with no lookup. A short timeout keeps a slow/broken
// DNS server from hanging the request that asked for this.
func resolveIP(ctx context.Context, host string) (string, error) {
	if ip := net.ParseIP(host); ip != nil {
		return host, nil
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupIPAddr(lookupCtx, host)
	if err != nil || len(addrs) == 0 {
		return "", err
	}
	// Prefer an IPv4 address — Outline's ss:// links and this dashboard's own
	// API-URL fields are conventionally IPv4, and a client dialing straight to
	// an IP skips the AAAA-vs-A fallback dance that a domain lookup would do
	// for it.
	for _, addr := range addrs {
		if v4 := addr.IP.To4(); v4 != nil {
			return v4.String(), nil
		}
	}
	return addrs[0].IP.String(), nil
}
