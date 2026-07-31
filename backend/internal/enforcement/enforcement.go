// Package enforcement contains the single reconciliation routine that
// decides, for a given key, whether Outline access should be on or off and
// pushes that decision to the Outline server. It is called both by the
// periodic cron job (internal/cron) and immediately/synchronously by the HTTP
// handlers (e.g. right after a top-up), so behavior is identical either way.
package enforcement

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strconv"
	"time"

	"outline-manager/internal/models"
	"outline-manager/internal/outline"
	"outline-manager/internal/repository"
)

type Enforcer struct {
	repo  *repository.Repository
	cache *outline.Cache
}

// ErrPushFailed marks a renewal (or other change) that was saved locally but
// could not be pushed to the Outline server — the caller should report a
// gateway-style failure rather than treating the whole operation as failed.
var ErrPushFailed = errors.New("push to outline server failed")

func New(repo *repository.Repository, cache *outline.Cache) *Enforcer {
	return &Enforcer{repo: repo, cache: cache}
}

// SyncServer pulls fresh access-key and usage data from one Outline server,
// adopts any keys not yet known locally, records usage snapshots, and then
// reconciles every key's enabled/disabled state. Errors talking to the Outline
// server are recorded on the server row and returned; the caller (cron loop)
// continues with the next server regardless.
func (e *Enforcer) SyncServer(ctx context.Context, server models.Server) error {
	client, err := e.cache.Get(server.ID, server.APIURL, server.CertSHA256)
	if err != nil {
		return e.failSync(ctx, server, "build client", err)
	}

	remoteKeys, err := client.ListAccessKeys(ctx)
	if err != nil {
		return e.failSync(ctx, server, "list access keys", err)
	}

	metrics, err := client.GetMetricsTransfer(ctx)
	if err != nil {
		return e.failSync(ctx, server, "get metrics", err)
	}

	for _, rk := range remoteKeys {
		local, err := e.repo.UpsertKeyFromOutline(ctx, server.ID, rk.ID, rk.Name, rk.AccessURL, rk.Port, rk.Method, rk.Password)
		if err != nil {
			log.Printf("server %s: upsert key %s: %v", server.Name, rk.ID, err)
			continue
		}

		usedBytes := usageForKey(metrics, rk.ID)
		if err := e.repo.UpdateKeyUsage(ctx, local.ID, usedBytes); err != nil {
			log.Printf("server %s: update usage for key %s: %v", server.Name, local.ID, err)
			continue
		}
		if err := e.repo.InsertUsageSnapshot(ctx, server.ID, &local.ID, usedBytes); err != nil {
			log.Printf("server %s: insert usage snapshot for key %s: %v", server.Name, local.ID, err)
		}
		local.UsedBytes = usedBytes

		if err := e.reconcileKey(ctx, client, *local, server.BandwidthDisabledAt != nil); err != nil {
			log.Printf("server %s: reconcile key %s: %v", server.Name, local.ID, err)
		}
	}

	if err := e.repo.InsertUsageSnapshot(ctx, server.ID, nil, sumTransfer(metrics)); err != nil {
		log.Printf("server %s: insert server usage snapshot: %v", server.Name, err)
	}

	if err := e.repo.MarkServerSynced(ctx, server.ID, nil); err != nil {
		log.Printf("server %s: mark synced: %v", server.Name, err)
	}
	return nil
}

// CheckBandwidthLimits trips the bandwidth kill switch for any server whose
// current calendar month's transfer has reached its cap (within
// models.BandwidthDisableMarginBytes), and forces every key on it to a
// 0-byte Outline limit immediately. Skips a server that was manually
// re-enabled already this calendar month, so it isn't re-disabled on the very
// next cron tick while usage is still technically over the cap.
func (e *Enforcer) CheckBandwidthLimits(ctx context.Context) {
	servers, err := e.repo.ListAllServers(ctx)
	if err != nil {
		log.Printf("check bandwidth limits: list servers: %v", err)
		return
	}
	now := time.Now()
	monthStart := models.StartOfMonth(now)
	for _, server := range servers {
		if server.BandwidthLimitBytes == nil || server.BandwidthDisabledAt != nil {
			continue
		}
		if server.BandwidthReenabledAt != nil && models.SameMonth(*server.BandwidthReenabledAt, now) {
			continue
		}
		used, err := e.repo.ServerUsageInRange(ctx, server.ID, monthStart, now)
		if err != nil {
			log.Printf("check bandwidth limits: usage for %s: %v", server.Name, err)
			continue
		}

		// Safety fallback: ServerUsageInRange is a delta against our own
		// earliest recorded snapshot for each key, so it under-reports for a
		// server (or a key on it) adopted partway through the month —
		// whatever usage already happened on Outline's side before our first
		// observation has no snapshot to diff against and is invisible to
		// us, not zero. When that's the situation, also check Outline's own
		// live 30-day figure and trip on whichever is higher, so a server
		// with a lot of pre-existing traffic can't sail past its cap
		// undetected just because our own tracking hasn't caught up yet.
		if earliest, eerr := e.repo.EarliestServerUsageSnapshot(ctx, server.ID); eerr != nil {
			log.Printf("check bandwidth limits: tracking start for %s: %v", server.Name, eerr)
		} else if earliest == nil || earliest.After(monthStart) {
			if live := e.liveBandwidth30d(ctx, server); live > used {
				log.Printf("server %s: tracked month-to-date (%d bytes) is a partial figure (tracking since %v) — using Outline's live 30d total (%d bytes) instead",
					server.Name, used, earliest, live)
				used = live
			}
		}

		if used < *server.BandwidthLimitBytes-models.BandwidthDisableMarginBytes {
			continue
		}
		if err := e.repo.SetServerBandwidthDisabled(ctx, server.ID); err != nil {
			log.Printf("check bandwidth limits: disable %s: %v", server.Name, err)
			continue
		}
		log.Printf("server %s: bandwidth cap reached (%d/%d bytes this month) — all keys disabled",
			server.Name, used, *server.BandwidthLimitBytes)
		server.BandwidthDisabledAt = &now
		if err := e.ReconcileServerKeys(ctx, server); err != nil {
			log.Printf("check bandwidth limits: reconcile %s: %v", server.Name, err)
		}
	}
}

// liveBandwidth30d is the CheckBandwidthLimits safety fallback's data
// source: Outline's own rolling-30-day transfer total for the server,
// fetched live rather than derived from our own snapshot history. Returns 0
// on any failure to reach the server — a fallback that can't be reached
// simply doesn't raise the figure, it never lowers it or blocks the
// tick, so a bad request here can't itself trip (or hide) a bandwidth cap.
func (e *Enforcer) liveBandwidth30d(ctx context.Context, server models.Server) int64 {
	client, err := e.cache.Get(server.ID, server.APIURL, server.CertSHA256)
	if err != nil {
		return 0
	}
	metrics, err := client.GetServerMetrics(ctx, outline.Window30d)
	if err != nil {
		log.Printf("live bandwidth fallback for %s: %v", server.Name, err)
		return 0
	}
	return int64(metrics.Server.DataTransferred.Bytes)
}

// deviceCountThreshold is how many simultaneous devices a key can show in a
// day before it looks like more than one person's normal phone+laptop+tablet
// set. Deliberately generous — this flags for a human to look at, it never
// disables anything on its own.
const deviceCountThreshold = 5

// deviceAlertDebounceHours keeps a key that stays over threshold across
// multiple ticks from being re-flagged every tick, mirroring the low-usage
// alert's debounce window.
const deviceAlertDebounceHours = 12

// CheckDeviceLimits reads live per-key device counts across every server and
// returns the ones over deviceCountThreshold that haven't been flagged
// recently. Detection only — nothing here disables a key or changes its
// state; the caller decides what to do with the list (internal/alerts posts
// it to Telegram).
func (e *Enforcer) CheckDeviceLimits(ctx context.Context) []models.DeviceAlert {
	servers, err := e.repo.ListAllServers(ctx)
	if err != nil {
		log.Printf("check device limits: list servers: %v", err)
		return nil
	}

	now := time.Now()
	var out []models.DeviceAlert
	for _, server := range servers {
		client, err := e.cache.Get(server.ID, server.APIURL, server.CertSHA256)
		if err != nil {
			continue
		}
		metrics, err := client.GetServerMetrics(ctx, outline.Window1d)
		if err != nil {
			log.Printf("check device limits: metrics for %s: %v", server.Name, err)
			continue
		}
		byOutlineID := models.BuildKeyMetrics(now, metrics)

		keys, err := e.repo.ListKeysByServer(ctx, server.ID)
		if err != nil {
			log.Printf("check device limits: list keys for %s: %v", server.Name, err)
			continue
		}
		for _, key := range keys {
			km, ok := byOutlineID[key.OutlineKeyID]
			if !ok || km.PeakDeviceCount <= deviceCountThreshold {
				continue
			}
			sentAt, err := e.repo.DeviceAlertSentAt(ctx, key.ID)
			if err != nil {
				log.Printf("check device limits: debounce lookup for key %s: %v", key.ID, err)
				continue
			}
			if sentAt != nil && now.Sub(*sentAt) < deviceAlertDebounceHours*time.Hour {
				continue
			}
			out = append(out, models.DeviceAlert{Key: key, ServerName: server.Name, PeakDeviceCount: km.PeakDeviceCount})
		}
	}
	return out
}

// autoRenewNote is stamped on every renewal AutoRenewKeys logs, so it reads
// clearly in the renewal history and the admin knows to go collect payment
// for it rather than assuming a manual renewal already means paid.
const autoRenewNote = "Auto-renewed — confirm payment"

// AutoRenewKeys tops up every auto_renew-opted-in key that has crossed the
// same "running low" condition the Telegram alert uses
// (models.RunningLowRemainingBytes/RunningLowDaysLeft).
//
// A renewal always grants a full plan period on top of what's already used,
// so one auto-renewal reliably pushes the key back out of the "running low"
// window — the next tick naturally sees it as fine again, no separate
// debounce bookkeeping needed. Every auto-renewal is logged unpaid
// (autoRenewNote) since staying online is not the same as being paid for;
// the admin confirms payment and flips it from the renewal history table.
func (e *Enforcer) AutoRenewKeys(ctx context.Context) []models.Key {
	keys, err := e.repo.ListKeysWithAutoRenew(ctx)
	if err != nil {
		log.Printf("auto renew: list keys: %v", err)
		return nil
	}

	now := time.Now()
	note := autoRenewNote
	var renewed []models.Key
	for _, key := range keys {
		key = key.Enrich(now)
		runningLow := key.RemainingBytes != nil && *key.RemainingBytes < models.RunningLowRemainingBytes
		nearExpiry := key.DaysLeft != nil && *key.DaysLeft < models.RunningLowDaysLeft
		if !runningLow && !nearExpiry {
			continue
		}
		updated, _, err := e.RenewKey(ctx, key.ID, models.MinPlanGB, models.MinPlanDays, false, &note)
		if err != nil && !errors.Is(err, ErrPushFailed) {
			log.Printf("auto renew: renew key %s: %v", key.ID, err)
			continue
		}
		if updated != nil {
			renewed = append(renewed, *updated)
		}
	}
	return renewed
}

// failSync records why a sync attempt failed on the server row and wraps the
// error with the stage it failed at.
func (e *Enforcer) failSync(ctx context.Context, server models.Server, stage string, cause error) error {
	err := fmt.Errorf("server %s: %s: %w", server.Name, stage, cause)
	if markErr := e.repo.MarkServerSynced(ctx, server.ID, err); markErr != nil {
		log.Printf("server %s: mark sync error: %v", server.Name, markErr)
	}
	return err
}

// usageForKey looks up a key's cumulative transferred bytes. Some Outline
// versions report the map keyed by the numeric id without leading zeros, so
// retry with a normalized form before giving up.
func usageForKey(m *outline.MetricsTransfer, outlineKeyID string) int64 {
	if v, ok := m.BytesTransferredByUserID[outlineKeyID]; ok {
		return v
	}
	if n, err := strconv.Atoi(outlineKeyID); err == nil {
		return m.BytesTransferredByUserID[strconv.Itoa(n)]
	}
	return 0
}

func sumTransfer(m *outline.MetricsTransfer) int64 {
	var total int64
	for _, v := range m.BytesTransferredByUserID {
		total += v
	}
	return total
}

// ReconcileKeyByID re-derives one key's desired state and pushes it to Outline
// immediately (used right after a create/renew action so the user doesn't have
// to wait for the next cron tick).
func (e *Enforcer) ReconcileKeyByID(ctx context.Context, keyID string) error {
	key, err := e.repo.GetKey(ctx, keyID)
	if err != nil {
		return err
	}
	server, err := e.repo.GetServer(ctx, key.ServerID)
	if err != nil {
		return err
	}
	client, err := e.cache.Get(server.ID, server.APIURL, server.CertSHA256)
	if err != nil {
		return err
	}
	return e.reconcileKey(ctx, client, *key, server.BandwidthDisabledAt != nil)
}

// ReconcileServerKeys re-pushes every key on one server against its current
// desired state — used after the bandwidth kill switch is manually cleared,
// so every key's real limit (not the forced-0 override) is restored without
// waiting for the next cron tick.
func (e *Enforcer) ReconcileServerKeys(ctx context.Context, server models.Server) error {
	client, err := e.cache.Get(server.ID, server.APIURL, server.CertSHA256)
	if err != nil {
		return err
	}
	keys, err := e.repo.ListKeysByServer(ctx, server.ID)
	if err != nil {
		return err
	}
	var lastErr error
	for _, key := range keys {
		if err := e.reconcileKey(ctx, client, key, server.BandwidthDisabledAt != nil); err != nil {
			log.Printf("server %s: reconcile key %s: %v", server.Name, key.ID, err)
			lastErr = err
		}
	}
	return lastErr
}

// RenewKey applies a smart quota renewal (see models.RenewalTarget) to one
// key, logs it, and pushes the result to Outline immediately. Shared by the
// HTTP renew endpoint, the Telegram extend-button webhook, and the auto-renew
// cron path so all three go through the exact same sequence: compute target,
// persist, log, reconcile. It also raises (never lowers) the key's own price
// to match its server's current default, if the server's default has gone up
// since the key's price was last set — a plain key change never does this.
//
// paid/paymentNote are bookkeeping only — they never affect what's granted,
// just what the renewal history and any "needs confirming" surfacing show
// afterward.
func (e *Enforcer) RenewKey(ctx context.Context, keyID string, addGB float64, addDays int, paid bool, paymentNote *string) (*models.Key, *models.RenewalLog, error) {
	key, err := e.repo.GetKey(ctx, keyID)
	if err != nil {
		return nil, nil, err
	}

	newLimitBytes, newEndDate := models.RenewalTarget(time.Now(), *key, addGB, addDays)

	if err := e.repo.SetKeyLimitAndEndDate(ctx, keyID, newLimitBytes, newEndDate); err != nil {
		return nil, nil, fmt.Errorf("set key limit and end date: %w", err)
	}

	server, err := e.repo.GetServer(ctx, key.ServerID)
	if err != nil {
		return nil, nil, fmt.Errorf("get server: %w", err)
	}

	// A renewal (manual or auto) is the one moment a price increase on the
	// server catches up to keys already sold at the old, lower price — never
	// on a plain key change, and never a decrease. A nil PriceMmk is left
	// alone: it already tracks the server's current default live via
	// COALESCE (see ListServers/SnapshotRevenue), so there's nothing to
	// catch up.
	effectivePriceMmk := key.PriceMmk
	if key.PriceMmk != nil && server.DefaultPriceMmk != nil && *server.DefaultPriceMmk > *key.PriceMmk {
		if err := e.repo.SetKeyPrice(ctx, keyID, server.DefaultPriceMmk); err != nil {
			return nil, nil, fmt.Errorf("sync key price to server default: %w", err)
		}
		effectivePriceMmk = server.DefaultPriceMmk
	}
	// amountMmk snapshots what this renewal was actually worth: the key's own
	// (possibly just-synced) price, or the server's current default when the
	// key has never had one set — the same COALESCE live revenue uses.
	amountMmk := effectivePriceMmk
	if amountMmk == nil {
		amountMmk = server.DefaultPriceMmk
	}

	renewal, err := e.repo.InsertRenewalLog(ctx, keyID, addGB, addDays, newLimitBytes, newEndDate, paid, paymentNote, amountMmk)
	if err != nil {
		return nil, nil, fmt.Errorf("insert renewal log: %w", err)
	}

	// The local save above already succeeded by this point, so a push
	// failure still returns the updated key (not nil) alongside the wrapped
	// ErrPushFailed — callers can show what was actually saved instead of
	// losing that detail just because the Outline push lagged behind.
	pushErr := e.ReconcileKeyByID(ctx, keyID)

	updated, err := e.repo.GetKey(ctx, keyID)
	if err != nil {
		return nil, nil, err
	}
	if pushErr != nil {
		return updated, renewal, fmt.Errorf("reconcile after renewal: %w: %w", ErrPushFailed, pushErr)
	}
	return updated, renewal, nil
}

// reconcileKey pushes one key's desired Outline state. bandwidthDisabled
// forces a 0-byte limit regardless of the key's own computed state — the
// server-wide bandwidth kill switch — without touching the key's own
// enabled/status bookkeeping, which still reflects its own plan and is
// restored automatically the moment bandwidthDisabled goes false again.
func (e *Enforcer) reconcileKey(ctx context.Context, client *outline.Client, key models.Key, bandwidthDisabled bool) error {
	status, _, _, shouldBeEnabled := models.DeriveKeyStatus(time.Now(), key.EndDate, key.CustomLimitBytes, key.UsedBytes, key.Enabled)
	pushEnabled := shouldBeEnabled && !bandwidthDisabled

	// Always push the current desired limit to Outline, not just on an
	// enabled/disabled transition: a renewal can change custom_limit_bytes
	// while the key stays enabled the whole time, and Outline's side must
	// reflect that new ceiling immediately rather than waiting for some future
	// disable/enable toggle to happen to carry it along.
	switch {
	case !pushEnabled:
		if err := client.SetDataLimit(ctx, key.OutlineKeyID, 0); err != nil {
			return fmt.Errorf("disable (zero limit): %w", err)
		}
	case key.CustomLimitBytes != nil:
		if err := client.SetDataLimit(ctx, key.OutlineKeyID, *key.CustomLimitBytes); err != nil {
			return fmt.Errorf("apply data limit: %w", err)
		}
	default:
		if err := client.RemoveDataLimit(ctx, key.OutlineKeyID); err != nil {
			return fmt.Errorf("remove data limit: %w", err)
		}
	}

	if shouldBeEnabled != key.Enabled || status != key.Status {
		return e.repo.SetKeyEnabledStatus(ctx, key.ID, shouldBeEnabled, status)
	}
	return nil
}
