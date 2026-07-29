package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
	"outline-manager/internal/models"
	"outline-manager/internal/outline"
	"outline-manager/internal/repository"
)

// usageRangeDefaultDays is the window GET /servers/:id/usage reports when the
// caller doesn't pass from/to.
const usageRangeDefaultDays = 30

// listMetricsTimeout caps the whole live-metrics fan-out on GET /servers, so
// the list stays responsive even when several servers are unreachable.
const listMetricsTimeout = 8 * time.Second

// sparklineDays is how much snapshot history each server card's chart covers.
const sparklineDays = 14

// revenueSparklineDays covers over a year, so the Revenue page's month/year
// views have something to group once enough daily snapshots exist — unlike
// the bandwidth sparkline, which only ever needs a couple of weeks.
const revenueSparklineDays = 400

type createServerRequest struct {
	Name string `json:"name" validate:"required"`
	// APIURL accepts either a bare management API URL or the whole JSON blob
	// the Outline installer prints — see parseManagementKey.
	APIURL          string   `json:"apiUrl" validate:"required"`
	CertSHA256      string   `json:"certSha256"`
	CostUSDPerMonth *float64 `json:"costUsdPerMonth"`
	// MaxKeys caps how many keys may be created here; nil means no ceiling.
	MaxKeys *int `json:"maxKeys"`
	// DefaultLimitGB is the quota new keys on this server start on; nil falls
	// back to the per-key plan floor.
	DefaultLimitGB *float64 `json:"defaultLimitGb"`
	// DefaultPriceMmk is what a new key on this server is sold for, in MMK;
	// nil means new keys start unpriced.
	DefaultPriceMmk *int64 `json:"defaultPriceMmk"`
	// BandwidthLimitGB is a monthly transfer cap (inbound + outbound); nil
	// means bandwidth isn't tracked against a cap for this server.
	BandwidthLimitGB *float64 `json:"bandwidthLimitGb"`
}

// managementKey is the JSON the Outline installer prints at the end of setup:
//
//	{"apiUrl":"https://host:port/secret","certSha256":"ABC..."}
//
// The fingerprint is a *separate field*, not embedded in the URL, so pasting
// only the URL is not enough to pin the certificate.
type managementKey struct {
	APIURL     string `json:"apiUrl"`
	CertSHA256 string `json:"certSha256"`
}

// parseManagementKey lets the operator paste the installer's whole JSON blob
// into the single "Outline API URL" field, which is what they actually have on
// their clipboard. A bare URL still works, but then certSha256 must be supplied
// separately — without a fingerprint there is nothing to pin the self-signed
// certificate against.
func parseManagementKey(apiURLField, certField string) (apiURL, certSHA256 string) {
	apiURL = strings.TrimSpace(apiURLField)
	certSHA256 = certField

	if strings.HasPrefix(apiURL, "{") {
		var mk managementKey
		if err := json.Unmarshal([]byte(apiURL), &mk); err == nil && mk.APIURL != "" {
			apiURL = strings.TrimSpace(mk.APIURL)
			if mk.CertSHA256 != "" {
				certSHA256 = mk.CertSHA256
			}
		}
	}
	return apiURL, outline.NormalizeFingerprint(certSHA256)
}

func (a *API) createServer(c fiber.Ctx) error {
	var req createServerRequest
	if !bindJSON(c, &req) {
		return nil
	}
	req.Name = strings.TrimSpace(req.Name)
	req.APIURL, req.CertSHA256 = parseManagementKey(req.APIURL, req.CertSHA256)

	if req.CostUSDPerMonth != nil && *req.CostUSDPerMonth < 0 {
		return apiresponse.Validation(c, apiresponse.FieldError{
			Field: "costUsdPerMonth", Message: "Cost cannot be negative",
		})
	}
	if req.MaxKeys != nil && *req.MaxKeys < 1 {
		return apiresponse.Validation(c, apiresponse.FieldError{
			Field: "maxKeys", Message: "Key limit must be at least 1 — leave it blank for no limit",
		})
	}
	if req.DefaultLimitGB != nil && *req.DefaultLimitGB <= 0 {
		return apiresponse.Validation(c, apiresponse.FieldError{
			Field: "defaultLimitGb", Message: "Default data limit must be greater than zero",
		})
	}
	if req.DefaultPriceMmk != nil && *req.DefaultPriceMmk < 0 {
		return apiresponse.Validation(c, apiresponse.FieldError{
			Field: "defaultPriceMmk", Message: "Price cannot be negative",
		})
	}
	if req.BandwidthLimitGB != nil && *req.BandwidthLimitGB <= 0 {
		return apiresponse.Validation(c, apiresponse.FieldError{
			Field: "bandwidthLimitGb", Message: "Bandwidth limit must be greater than zero",
		})
	}
	var defaultLimitBytes *int64
	if req.DefaultLimitGB != nil {
		v := int64(*req.DefaultLimitGB * models.BytesPerGB)
		defaultLimitBytes = &v
	}
	var bandwidthLimitBytes *int64
	if req.BandwidthLimitGB != nil {
		v := int64(*req.BandwidthLimitGB * models.BytesPerGB)
		bandwidthLimitBytes = &v
	}

	// Validate reachability + cert pin before persisting a broken server.
	client, err := outline.New(req.APIURL, req.CertSHA256, a.timeout)
	if err != nil {
		return apiresponse.Validation(c, apiresponse.FieldError{
			Field:   "apiUrl",
			Message: "Paste the full management key JSON from your Outline install output, including certSha256",
		})
	}
	if _, err := client.GetServerInfo(c.Context()); err != nil {
		return apiresponse.Validation(c, apiresponse.FieldError{
			Field:   "apiUrl",
			Message: "Invalid Outline API Management Key or cert connection failed",
		})
	}

	// A server already at this exact management-key URL is either a genuine
	// duplicate (reject it) or one the admin previously removed — archived,
	// not gone, precisely so this moment can restore it instead of starting
	// over. See repository.DeleteServer/ReviveServer.
	existing, err := a.repo.GetServerByAPIURL(c.Context(), req.APIURL)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return apiresponse.Internal(c, "")
	}
	if err == nil {
		if !existing.Deleted {
			return apiresponse.Conflict(c, "This server has already been added")
		}
		if existing.CertSHA256 != req.CertSHA256 {
			return apiresponse.Validation(c, apiresponse.FieldError{
				Field:   "apiUrl",
				Message: "This URL matches a previously removed server, but the certificate fingerprint doesn't match — double-check the management key",
			})
		}
		server, err := a.repo.ReviveServer(c.Context(), existing.ID, req.Name, req.APIURL, req.CertSHA256, req.CostUSDPerMonth, req.MaxKeys, defaultLimitBytes, req.DefaultPriceMmk, bandwidthLimitBytes)
		if err != nil {
			return apiresponse.Internal(c, "")
		}
		a.syncServerInBackground(*server)
		return apiresponse.Created(c, server, "Server restored — its keys, limits and history are back")
	}

	server, err := a.repo.CreateServer(c.Context(), req.Name, req.APIURL, req.CertSHA256, req.CostUSDPerMonth, req.MaxKeys, defaultLimitBytes, req.DefaultPriceMmk, bandwidthLimitBytes)
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	a.syncServerInBackground(*server)

	return apiresponse.Created(c, server, "Server added")
}

// syncServerInBackground adopts a server's existing keys asynchronously: a
// server with many keys would otherwise make the add/revive request hang on
// a full sync. Deliberately detached from the request context so it isn't
// cancelled when the response is sent.
func (a *API) syncServerInBackground(s models.Server) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		a.enforcer.SyncServer(ctx, s)
	}()
}

// metricsWindow reads the ?window= query parameter. Outline only supports
// 1d/7d/30d (it 500s on anything longer), so an unrecognised value falls back
// to 30d rather than being forwarded and failing upstream.
func metricsWindow(c fiber.Ctx) outline.MetricsWindow {
	switch c.Query("window") {
	case "1d":
		return outline.Window1d
	case "7d":
		return outline.Window7d
	default:
		return outline.Window30d
	}
}

// liveMetrics reads one server's metrics straight from Outline. A failure is
// not an error for the caller: the server row still renders, just without live
// numbers, and its health drops to "degraded".
func (a *API) liveMetrics(ctx context.Context, server models.Server, window outline.MetricsWindow) (*models.ServerMetrics, map[string]models.KeyMetrics) {
	client, err := a.cache.Get(server.ID, server.APIURL, server.CertSHA256)
	if err != nil {
		return nil, nil
	}
	raw, err := client.GetServerMetrics(ctx, window)
	if err != nil {
		log.Printf("server %s: live metrics: %v", server.Name, err)
		return nil, nil
	}
	now := time.Now()
	return models.BuildServerMetrics(now, string(window), raw), models.BuildKeyMetrics(now, raw)
}

func (a *API) listServers(c fiber.Ctx) error {
	servers, err := a.repo.ListServers(c.Context())
	if err != nil {
		return apiresponse.Internal(c, "")
	}

	window := metricsWindow(c)

	// One query for every server's sparkline, rather than one per card.
	series, err := a.repo.DailyUsageAllServers(c.Context(), sparklineDays)
	if err != nil {
		log.Printf("list servers: daily usage: %v", err)
		series = nil // a missing sparkline must not fail the whole list
	}
	revenueSeries, err := a.repo.DailyRevenueAllServers(c.Context(), revenueSparklineDays)
	if err != nil {
		log.Printf("list servers: daily revenue: %v", err)
		revenueSeries = nil
	}

	// Fan out across servers rather than fetching serially: one slow or
	// unreachable server would otherwise add its full timeout to every server
	// behind it in the list.
	ctx, cancel := context.WithTimeout(c.Context(), listMetricsTimeout)
	defer cancel()

	var wg sync.WaitGroup
	for i := range servers {
		wg.Add(1)
		go func(s *models.ServerWithUsage) {
			defer wg.Done()
			s.Hostname = s.Server.Hostname()
			s.Metrics, _ = a.liveMetrics(ctx, s.Server, window)
			s.Health = models.DeriveServerHealth(s.LastSyncError, s.LastSyncedAt, s.Metrics != nil)
			if s.DailySeries = series[s.ID]; s.DailySeries == nil {
				s.DailySeries = []models.DailyUsage{}
			}
			if s.RevenueDailySeries = revenueSeries[s.ID]; s.RevenueDailySeries == nil {
				s.RevenueDailySeries = []models.RevenuePoint{}
			}
			s.BandwidthUsedBytesThisMonth, s.BandwidthTrackingSince, s.BandwidthTrackingComplete =
				a.bandwidthThisMonth(ctx, s.Server)
		}(&servers[i])
	}
	wg.Wait()

	return apiresponse.Success(c, servers, "")
}

// bandwidthThisMonth computes a server's calendar-month-to-date transfer
// (nil BandwidthLimitBytes means no cap is configured, so it's skipped
// entirely rather than returning a meaningless zero) plus whether that
// figure is a complete reading — see models.ServerWithUsage's field docs for
// why an incomplete one under-reports rather than being simply small.
func (a *API) bandwidthThisMonth(ctx context.Context, server models.Server) (used int64, trackingSince *time.Time, complete bool) {
	if server.BandwidthLimitBytes == nil {
		return 0, nil, true
	}
	monthStart := models.StartOfMonth(time.Now())
	used, err := a.repo.ServerUsageInRange(ctx, server.ID, monthStart, time.Now())
	if err != nil {
		log.Printf("bandwidth this month for %s: %v", server.Name, err)
	}
	trackingSince, err = a.repo.EarliestServerUsageSnapshot(ctx, server.ID)
	if err != nil {
		log.Printf("bandwidth tracking start for %s: %v", server.Name, err)
		return used, nil, true
	}
	complete = trackingSince != nil && !trackingSince.After(monthStart)
	return used, trackingSince, complete
}

// accessKeyHostname reads the host baked into the first key with a non-empty
// accessUrl — every key on a server shares the same host, so the first one
// found is representative of all of them. Empty when the server has no keys
// yet, in which case the dialog falls back to placeholder text.
func accessKeyHostname(keys []models.Key) string {
	for _, k := range keys {
		if h := models.AccessKeyHostname(k.AccessURL); h != "" {
			return h
		}
	}
	return ""
}

func (a *API) getServer(c fiber.Ctx) error {
	id := c.Params("id")
	server, err := a.repo.GetServer(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}

	keys, err := a.repo.ListKeysByServer(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}

	window := metricsWindow(c)
	metrics, keyMetrics := a.liveMetrics(c.Context(), *server, window)

	// Same span as the server list's sparkline and a key's daily chart, so all
	// three read as one consistent "recent history" window across the app.
	dailySeries, err := a.repo.DailyUsageByServer(c.Context(), id, sparklineDays)
	if err != nil {
		log.Printf("get server %s: daily usage: %v", id, err)
		dailySeries = []models.DailyUsage{}
	}

	bandwidthUsedThisMonth, bandwidthTrackingSince, bandwidthTrackingComplete := a.bandwidthThisMonth(c.Context(), *server)

	return apiresponse.Success(c, fiber.Map{
		"server":   server,
		"hostname": server.Hostname(),
		// accessKeyHostname is the host actually baked into this server's
		// static ss:// links right now (Outline's "hostname for access
		// keys"), which is not necessarily the same as the API URL's own
		// host above — the edit-server dialog prefills its domain field
		// with this, not with hostname.
		"accessKeyHostname":           accessKeyHostname(keys),
		"health":                      models.DeriveServerHealth(server.LastSyncError, server.LastSyncedAt, metrics != nil),
		"metrics":                     metrics,
		"keys":                        a.enrichKeys(keys),
		"keyMetrics":                  keyMetrics,
		"dailySeries":                 dailySeries,
		"bandwidthUsedBytesThisMonth": bandwidthUsedThisMonth,
		"bandwidthTrackingSince":      bandwidthTrackingSince,
		"bandwidthTrackingComplete":   bandwidthTrackingComplete,
	}, "")
}

// updateServerConfigRequest carries everything the "edit server" dialog can
// change. Every field is nil-to-skip, so the dialog sends only what actually
// changed and a partial update never blanks a field it wasn't asked about.
type updateServerConfigRequest struct {
	// HostnameForAccessKeys is pushed straight to the Outline server, which
	// rewrites the host in every static ss:// link (existing keys included).
	// Nil leaves it untouched; a non-nil empty string is rejected rather than
	// silently ignored, since Outline itself requires a non-empty hostname.
	HostnameForAccessKeys *string `json:"hostnameForAccessKeys"`

	// Name and CostUSDPerMonth are local display/accounting metadata — neither
	// is pushed to Outline, which has its own unrelated server name.
	Name            *string  `json:"name"`
	CostUSDPerMonth *float64 `json:"costUsdPerMonth"`

	// MaxKeys caps key creation on this server. A nil pointer leaves the
	// current ceiling alone; ClearMaxKeys is how the dialog removes one, since
	// "absent" and "explicitly none" cannot both be expressed by nil.
	MaxKeys      *int `json:"maxKeys"`
	ClearMaxKeys bool `json:"clearMaxKeys"`

	// DefaultPriceMmk is what a new key on this server is sold for, in MMK.
	// Same nil-to-skip / ClearDefaultPriceMmk-to-remove pairing as MaxKeys.
	DefaultPriceMmk      *int64 `json:"defaultPriceMmk"`
	ClearDefaultPriceMmk bool   `json:"clearDefaultPriceMmk"`

	// BandwidthLimitGB is the monthly transfer cap. Same nil-to-skip /
	// ClearBandwidthLimit-to-remove pairing as MaxKeys.
	BandwidthLimitGB    *float64 `json:"bandwidthLimitGb"`
	ClearBandwidthLimit bool     `json:"clearBandwidthLimit"`
}

// stripURLScheme mirrors config.normalizeBaseURL: operators naturally paste a
// full "https://1.2.3.4:443" even though the ssconf:// link only wants the
// bare host[:port] to prefix its own scheme onto.
func stripURLScheme(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "https://")
	s = strings.TrimPrefix(s, "http://")
	return strings.TrimRight(s, "/")
}

// updateServerConfig applies the edit-server dialog: the display name, the
// monthly cost, the key ceiling, and the domain/IP baked into this server's
// static ss:// links. Only the hostname leaves this process — it is pushed to
// Outline, which rewrites every existing key's link. Dynamic ssconf:// links
// always use the deployment-wide config.PublicBaseURL, so there is no
// per-server override for them.
//
// Local metadata is written first and the hostname push last, because the push
// is the only step that can fail on someone else's server: a rejected hostname
// then leaves the name/cost edits saved rather than silently discarding them.
func (a *API) updateServerConfig(c fiber.Ctx) error {
	id := c.Params("id")
	server, err := a.repo.GetServer(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}

	var req updateServerConfigRequest
	if !bindJSON(c, &req) {
		return nil
	}
	if req.HostnameForAccessKeys == nil && req.Name == nil && req.CostUSDPerMonth == nil &&
		req.MaxKeys == nil && !req.ClearMaxKeys &&
		req.DefaultPriceMmk == nil && !req.ClearDefaultPriceMmk &&
		req.BandwidthLimitGB == nil && !req.ClearBandwidthLimit {
		return apiresponse.Validation(c, apiresponse.FieldError{
			Field: "name", Message: "Nothing to update",
		})
	}

	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if trimmed == "" {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "name", Message: "Server name is required"})
		}
		req.Name = &trimmed
	}
	if req.CostUSDPerMonth != nil && *req.CostUSDPerMonth < 0 {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "costUsdPerMonth", Message: "Cost cannot be negative"})
	}
	if req.MaxKeys != nil {
		if *req.MaxKeys < 1 {
			return apiresponse.Validation(c, apiresponse.FieldError{
				Field: "maxKeys", Message: "Key limit must be at least 1 — leave it blank for no limit",
			})
		}
		// A ceiling below the keys already on the server is accepted but
		// reported, since it can only be honoured going forward: existing keys
		// are never deleted to satisfy it.
		count, cerr := a.repo.CountKeysByServer(c.Context(), id)
		if cerr != nil {
			return respondRepoErr(c, cerr)
		}
		if *req.MaxKeys < count {
			return apiresponse.Validation(c, apiresponse.FieldError{
				Field:   "maxKeys",
				Message: fmt.Sprintf("This server already has %d key%s — set the limit to %d or higher, or delete keys first", count, plural(count), count),
			})
		}
	}

	if req.DefaultPriceMmk != nil && *req.DefaultPriceMmk < 0 {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "defaultPriceMmk", Message: "Price cannot be negative"})
	}
	if req.BandwidthLimitGB != nil && *req.BandwidthLimitGB <= 0 {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "bandwidthLimitGb", Message: "Bandwidth limit must be greater than zero"})
	}

	var bandwidthLimitBytes *int64
	if req.BandwidthLimitGB != nil {
		v := int64(*req.BandwidthLimitGB * models.BytesPerGB)
		bandwidthLimitBytes = &v
	}

	if req.Name != nil || req.CostUSDPerMonth != nil || req.MaxKeys != nil || req.DefaultPriceMmk != nil || bandwidthLimitBytes != nil {
		if _, uerr := a.repo.UpdateServerDetails(c.Context(), id, req.Name, req.CostUSDPerMonth, req.MaxKeys, req.DefaultPriceMmk, bandwidthLimitBytes); uerr != nil {
			return respondRepoErr(c, uerr)
		}
	}
	if req.ClearMaxKeys {
		if cerr := a.repo.ClearServerMaxKeys(c.Context(), id); cerr != nil {
			return respondRepoErr(c, cerr)
		}
	}
	if req.ClearDefaultPriceMmk {
		if cerr := a.repo.ClearServerDefaultPrice(c.Context(), id); cerr != nil {
			return respondRepoErr(c, cerr)
		}
	}
	if req.ClearBandwidthLimit {
		if cerr := a.repo.ClearServerBandwidthLimit(c.Context(), id); cerr != nil {
			return respondRepoErr(c, cerr)
		}
	}

	if req.HostnameForAccessKeys != nil {
		hostname := stripURLScheme(*req.HostnameForAccessKeys)
		if hostname == "" {
			return apiresponse.Validation(c, apiresponse.FieldError{
				Field: "hostnameForAccessKeys", Message: "Hostname is required",
			})
		}
		client, cerr := a.cache.Get(server.ID, server.APIURL, server.CertSHA256)
		if cerr != nil {
			return apiresponse.BadGateway(c, "Could not connect to the Outline server")
		}
		if serr := client.SetHostnameForAccessKeys(c.Context(), hostname); serr != nil {
			return apiresponse.BadGateway(c, "Outline rejected that hostname")
		}
		// Every key's accessUrl embeds the old host; resync immediately so the
		// dashboard reflects the change without waiting for the next cron tick.
		if serr := a.enforcer.SyncServer(c.Context(), *server); serr != nil {
			return apiresponse.BadGateway(c, "Hostname was updated but the dashboard could not refresh key links yet — try Sync now")
		}
	}

	updated, err := a.repo.GetServer(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.Success(c, updated, "Server settings updated")
}

// reenableServerBandwidth is the manual admin action after a bandwidth kill
// switch trip: clears it and pushes every key's own real computed limit back
// to Outline (undoing the forced 0-byte override), without touching any
// key's own plan/status bookkeeping — that was never changed by the trip in
// the first place.
func (a *API) reenableServerBandwidth(c fiber.Ctx) error {
	id := c.Params("id")
	if _, err := a.repo.GetServer(c.Context(), id); err != nil {
		return respondRepoErr(c, err)
	}
	if err := a.repo.ClearServerBandwidthDisabled(c.Context(), id); err != nil {
		return respondRepoErr(c, err)
	}
	// Re-fetched, not reused from above: reconcile must see
	// BandwidthDisabledAt already cleared, or it would just re-push the same
	// forced-0 override it's supposed to be undoing.
	updated, err := a.repo.GetServer(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	if err := a.enforcer.ReconcileServerKeys(c.Context(), *updated); err != nil {
		return apiresponse.BadGateway(c, "Re-enabled, but some keys could not be restored on the Outline server yet — try Sync now")
	}
	return apiresponse.Success(c, updated, "Server bandwidth re-enabled")
}

// setServerDefaultLimitRequest is the "overall data limit" control above the
// access-keys table.
type setServerDefaultLimitRequest struct {
	// LimitGB becomes the server's default quota. Nil (or ClearDefault) drops
	// the default, leaving new keys on the plan floor.
	LimitGB      *float64 `json:"limit_gb"`
	ClearDefault bool     `json:"clear_default"`
	// ApplyToUnlimited also pushes the new figure onto every key on this
	// server that currently has no ceiling. Keys that already carry one are
	// never touched — an individually-negotiated allowance must survive a
	// change to the server default.
	ApplyToUnlimited bool `json:"apply_to_unlimited"`
}

// setServerDefaultLimit sets the quota new keys on this server start on, and
// optionally brings existing unlimited keys onto the same figure. Each key it
// changes goes through the same reconciler the cron uses, so the new ceiling
// reaches Outline immediately rather than at the next tick.
func (a *API) setServerDefaultLimit(c fiber.Ctx) error {
	id := c.Params("id")
	if _, err := a.repo.GetServer(c.Context(), id); err != nil {
		return respondRepoErr(c, err)
	}

	var req setServerDefaultLimitRequest
	if !bindJSON(c, &req) {
		return nil
	}
	if !req.ClearDefault && req.LimitGB == nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "limit_gb", Message: "Enter a data limit"})
	}

	var limitBytes *int64
	if !req.ClearDefault {
		if *req.LimitGB <= 0 {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "limit_gb", Message: "Data limit must be greater than zero"})
		}
		v := int64(*req.LimitGB * models.BytesPerGB)
		limitBytes = &v
	}

	if err := a.repo.SetServerDefaultLimit(c.Context(), id, limitBytes); err != nil {
		return respondRepoErr(c, err)
	}

	applied := 0
	if req.ApplyToUnlimited && limitBytes != nil {
		changed, err := a.repo.ApplyDefaultLimitToUnlimitedKeys(c.Context(), id, *limitBytes)
		if err != nil {
			return respondRepoErr(c, err)
		}
		applied = len(changed)
		for _, keyID := range changed {
			// Log and carry on: a key that can't be reached now still has the
			// right figure in the DB, and the next cron tick pushes it.
			if err := a.enforcer.ReconcileKeyByID(c.Context(), keyID); err != nil {
				log.Printf("default limit: reconcile key %s: %v", keyID, err)
			}
		}
	}

	updated, err := a.repo.GetServer(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	msg := "Default data limit cleared"
	if limitBytes != nil {
		msg = fmt.Sprintf("Default data limit set — %d existing unlimited key%s updated", applied, plural(applied))
	}
	return apiresponse.Success(c, fiber.Map{"server": updated, "keysUpdated": applied}, msg)
}

func (a *API) deleteServer(c fiber.Ctx) error {
	id := c.Params("id")
	if err := a.repo.DeleteServer(c.Context(), id); err != nil {
		return respondRepoErr(c, err)
	}
	a.cache.Invalidate(id)
	return apiresponse.NoContentOK(c, "Server removed")
}

func (a *API) syncServer(c fiber.Ctx) error {
	id := c.Params("id")
	server, err := a.repo.GetServer(c.Context(), id)
	if err != nil {
		return respondRepoErr(c, err)
	}
	if err := a.enforcer.SyncServer(c.Context(), *server); err != nil {
		return apiresponse.BadGateway(c, "Could not reach the Outline server to sync")
	}
	return apiresponse.Success(c, fiber.Map{"status": "synced"}, "Server synced")
}

// perServerSyncTimeout bounds one server's sync when fanning every server out
// at once, so a single unreachable one can't hold up the response past what
// the caller reasonably waits on an explicit "sync now" click.
const perServerSyncTimeout = 20 * time.Second

// syncAllServers syncs every server concurrently and blocks until they all
// finish, so the admin gets a real pass/fail count back rather than a
// fire-and-forget "started" response. Deliberately not driven by c.Context()
// (capped at cfg.RequestTimeout, ~15s by default) — several servers running
// concurrently, each individually allowed up to perServerSyncTimeout, would
// otherwise risk the whole request getting cut off before they're done. Each
// sync gets its own context off context.Background() instead, same as
// syncServerInBackground.
func (a *API) syncAllServers(c fiber.Ctx) error {
	servers, err := a.repo.ListAllServers(c.Context())
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	if len(servers) == 0 {
		return apiresponse.Success(c, fiber.Map{"total": 0, "synced": 0, "failed": 0}, "No servers to sync")
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	failed := 0
	for _, s := range servers {
		wg.Add(1)
		go func(s models.Server) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), perServerSyncTimeout)
			defer cancel()
			if err := a.enforcer.SyncServer(ctx, s); err != nil {
				log.Printf("sync all: server %s: %v", s.Name, err)
				mu.Lock()
				failed++
				mu.Unlock()
			}
		}(s)
	}
	wg.Wait()

	synced := len(servers) - failed
	msg := fmt.Sprintf("Synced %d server%s", synced, plural(synced))
	if failed > 0 {
		msg = fmt.Sprintf("Synced %d of %d server%s — %d could not be reached", synced, len(servers), plural(len(servers)), failed)
	}
	return apiresponse.Success(c, fiber.Map{"total": len(servers), "synced": synced, "failed": failed}, msg)
}

func (a *API) getServerUsage(c fiber.Ctx) error {
	id := c.Params("id")
	if _, err := a.repo.GetServer(c.Context(), id); err != nil {
		return respondRepoErr(c, err)
	}

	to, err := parseTimeQuery(c, "to", time.Now())
	if err != nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "to", Message: err.Error()})
	}
	from, err := parseTimeQuery(c, "from", to.AddDate(0, 0, -usageRangeDefaultDays))
	if err != nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "from", Message: err.Error()})
	}
	if from.After(to) {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "from", Message: "from must be before to"})
	}

	total, err := a.repo.ServerUsageInRange(c.Context(), id, from, to)
	if err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.Success(c, fiber.Map{"serverId": id, "from": from, "to": to, "bytesUsed": total}, "")
}

// parseTimeQuery reads an RFC3339 query parameter, returning fallback when it
// is absent. An unparseable value is an error rather than being silently
// ignored, so a client bug doesn't look like a suspiciously wide date range.
func parseTimeQuery(c fiber.Ctx, name string, fallback time.Time) (time.Time, error) {
	v := c.Query(name)
	if v == "" {
		return fallback, nil
	}
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return time.Time{}, fmt.Errorf("must be an RFC3339 timestamp")
	}
	return t, nil
}
