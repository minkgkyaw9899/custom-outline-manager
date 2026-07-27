// Package outline is a client for the Outline Server ("Shadowbox") management
// API. The API is served over HTTPS with a self-signed certificate, so instead
// of normal CA validation we pin the exact leaf certificate fingerprint the
// operator supplied when adding the server (the same certSha256 the Outline
// Manager app itself uses).
package outline

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	http    *http.Client
}

type AccessKey struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Password  string `json:"password"`
	Port      int    `json:"port"`
	Method    string `json:"method"`
	AccessURL string `json:"accessUrl"`
	DataLimit *struct {
		Bytes int64 `json:"bytes"`
	} `json:"dataLimit,omitempty"`
}

type accessKeyList struct {
	AccessKeys []AccessKey `json:"accessKeys"`
}

type MetricsTransfer struct {
	BytesTransferredByUserID map[string]int64 `json:"bytesTransferredByUserId"`
}

type ServerInfo struct {
	Name                 string `json:"name"`
	ServerID             string `json:"serverId"`
	Version              string `json:"version"`
	PortForNewAccessKeys int    `json:"portForNewAccessKeys"`
}

// ServerMetrics mirrors GET /experimental/server/metrics?since=...
//
// Two things about this endpoint drive most of the UI's shape:
//
//   - There is no inbound/outbound split. Outline reports a single
//     DataTransferred total, so anything showing directional traffic has to be
//     derived from something other than this API.
//   - It returns aggregates over the window, not a time series. Per-day charts
//     have to come from our own usage_snapshots history instead.
//
// Bandwidth values are *rates* in bytes per second, not totals.
type ServerMetrics struct {
	Server struct {
		TunnelTime      Seconds `json:"tunnelTime"`
		DataTransferred Bytes   `json:"dataTransferred"`
		Bandwidth       struct {
			Current BandwidthSample `json:"current"`
			Peak    BandwidthSample `json:"peak"`
		} `json:"bandwidth"`
		Locations []LocationMetrics `json:"locations"`
	} `json:"server"`
	AccessKeys []AccessKeyMetrics `json:"accessKeys"`
}

type Bytes struct {
	Bytes float64 `json:"bytes"`
}

type Seconds struct {
	Seconds float64 `json:"seconds"`
}

// BandwidthSample carries a rate in bytes/second and the instant it was taken.
//
// Timestamp is a float, not an integer: a live server returns values like
// 1784994153.762. Decoding it as int64 fails outright, so this must stay
// float64 even though it reads as a Unix second count.
type BandwidthSample struct {
	Data      Bytes   `json:"data"`
	Timestamp float64 `json:"timestamp"`
}

// LocationMetrics is one autonomous system the server saw traffic from —
// what the Outline Manager UI labels "ASes with most bandwidth usage".
// Location is an ISO country code for the *client*, not the server.
type LocationMetrics struct {
	Location        string  `json:"location"`
	ASN             int     `json:"asn"`
	ASOrg           string  `json:"asOrg"`
	DataTransferred Bytes   `json:"dataTransferred"`
	TunnelTime      Seconds `json:"tunnelTime"`
}

type AccessKeyMetrics struct {
	AccessKeyID     int            `json:"accessKeyId"`
	DataTransferred Bytes          `json:"dataTransferred"`
	TunnelTime      Seconds        `json:"tunnelTime"`
	Connection      *KeyConnection `json:"connection"`
}

// KeyConnection is nil for a key with no traffic in the window. Timestamps are
// floats here for the same reason as BandwidthSample.
type KeyConnection struct {
	LastTrafficSeen float64 `json:"lastTrafficSeen"`
	PeakDeviceCount struct {
		Data      int     `json:"data"`
		Timestamp float64 `json:"timestamp"`
	} `json:"peakDeviceCount"`
}

// MetricsWindow is a supported value for the endpoint's `since` parameter.
// Outline rejects anything longer than 30d (it 500s on 90d/365d), so these
// three are the whole set.
type MetricsWindow string

const (
	Window1d  MetricsWindow = "1d"
	Window7d  MetricsWindow = "7d"
	Window30d MetricsWindow = "30d"
)

// ErrUnreachable wraps any network/TLS/HTTP error talking to a server so
// callers can distinguish "server down" from "programming error".
type ErrUnreachable struct {
	Err error
}

func (e *ErrUnreachable) Error() string { return fmt.Sprintf("outline server unreachable: %v", e.Err) }
func (e *ErrUnreachable) Unwrap() error { return e.Err }

// New builds a Client pinned to certSHA256 (case-insensitive hex, colons or
// no colons both accepted, matching the format Outline Manager exports).
func New(apiURL, certSHA256 string, timeout time.Duration) (*Client, error) {
	if !strings.HasPrefix(apiURL, "https://") && !strings.HasPrefix(apiURL, "http://") {
		return nil, fmt.Errorf("api_url must start with https:// or http://")
	}

	want := NormalizeFingerprint(certSHA256)
	if len(want) != sha256.Size*2 {
		return nil, fmt.Errorf("invalid cert_sha256 fingerprint")
	}
	if _, err := hex.DecodeString(want); err != nil {
		return nil, fmt.Errorf("invalid cert_sha256 fingerprint: not hex")
	}

	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true, // we verify manually via pinning below
			VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
				if len(rawCerts) == 0 {
					return fmt.Errorf("no peer certificate presented")
				}
				sum := sha256.Sum256(rawCerts[0])
				got := hex.EncodeToString(sum[:])
				if !strings.EqualFold(got, want) {
					return fmt.Errorf("certificate fingerprint mismatch: got %s want %s", got, want)
				}
				return nil
			},
		},
	}

	return &Client{
		baseURL: strings.TrimRight(apiURL, "/"),
		http:    &http.Client{Transport: transport, Timeout: timeout},
	}, nil
}

// NormalizeFingerprint lowercases a SHA-256 fingerprint and strips the colons
// and spaces that different tools insert between octets.
func NormalizeFingerprint(s string) string {
	s = strings.ReplaceAll(s, ":", "")
	s = strings.ReplaceAll(s, " ", "")
	return strings.ToLower(strings.TrimSpace(s))
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request body: %w", err)
		}
		reader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return &ErrUnreachable{Err: err}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return fmt.Errorf("outline API %s %s: status %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("decode response from %s: %w", path, err)
		}
	}
	return nil
}

func (c *Client) GetServerInfo(ctx context.Context) (*ServerInfo, error) {
	var info ServerInfo
	if err := c.do(ctx, http.MethodGet, "/server", nil, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

func (c *Client) ListAccessKeys(ctx context.Context) ([]AccessKey, error) {
	var list accessKeyList
	if err := c.do(ctx, http.MethodGet, "/access-keys", nil, &list); err != nil {
		return nil, err
	}
	return list.AccessKeys, nil
}

// CreateAccessKey provisions a key and, if name is non-empty, labels it. A
// rename failure returns the created key alongside the error so the caller can
// still clean up (or adopt) the key that now exists on the server.
func (c *Client) CreateAccessKey(ctx context.Context, name string) (*AccessKey, error) {
	var key AccessKey
	if err := c.do(ctx, http.MethodPost, "/access-keys", nil, &key); err != nil {
		return nil, err
	}
	if name != "" {
		if err := c.RenameAccessKey(ctx, key.ID, name); err != nil {
			return &key, err
		}
		key.Name = name
	}
	return &key, nil
}

func (c *Client) RenameAccessKey(ctx context.Context, id, name string) error {
	return c.do(ctx, http.MethodPut, "/access-keys/"+id+"/name", map[string]string{"name": name}, nil)
}

func (c *Client) DeleteAccessKey(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/access-keys/"+id, nil, nil)
}

func (c *Client) GetMetricsTransfer(ctx context.Context) (*MetricsTransfer, error) {
	var m MetricsTransfer
	if err := c.do(ctx, http.MethodGet, "/metrics/transfer", nil, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// GetServerMetrics fetches the aggregate metrics powering the "Server Metrics"
// view: total transferred, tunnel time, current/peak bandwidth rate, and the
// per-AS breakdown. An empty window defaults to 30d.
func (c *Client) GetServerMetrics(ctx context.Context, window MetricsWindow) (*ServerMetrics, error) {
	if window == "" {
		window = Window30d
	}
	var m ServerMetrics
	if err := c.do(ctx, http.MethodGet, "/experimental/server/metrics?since="+string(window), nil, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// dataLimitBody is the shape the Outline API requires: bytes nested under a
// "limit" object, not a bare {"bytes": N}. A flat body fails the server's
// schema validation and the limit is never actually applied, even though the
// request returns before any status check would notice a silent no-op.
type dataLimitBody struct {
	Limit struct {
		Bytes int64 `json:"bytes"`
	} `json:"limit"`
}

// SetDataLimit pushes an enforced ceiling (bytes) for the key. Passing 0
// effectively disables the key (matches the enforcement scheme in the spec).
func (c *Client) SetDataLimit(ctx context.Context, id string, bytes int64) error {
	var body dataLimitBody
	body.Limit.Bytes = bytes
	return c.do(ctx, http.MethodPut, "/access-keys/"+id+"/data-limit", body, nil)
}

// RemoveDataLimit deletes the key's data limit, restoring unlimited access.
func (c *Client) RemoveDataLimit(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/access-keys/"+id+"/data-limit", nil, nil)
}

// hostnameBody is the shape PUT /server/hostname-for-access-keys expects.
type hostnameBody struct {
	Hostname string `json:"hostname"`
}

// SetHostnameForAccessKeys changes the host Outline stamps into every
// access key's static ss:// link — both existing keys and any created from
// here on — without having to redistribute a new link per key. This is the
// same "Change hostname for access keys" action Outline Manager exposes
// under a server's settings; it accepts either a domain or a bare IP.
func (c *Client) SetHostnameForAccessKeys(ctx context.Context, hostname string) error {
	return c.do(ctx, http.MethodPut, "/server/hostname-for-access-keys", hostnameBody{Hostname: hostname}, nil)
}
