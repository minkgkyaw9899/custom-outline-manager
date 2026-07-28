// Package enforcement contains the single reconciliation routine that
// decides, for a given key, whether Outline access should be on or off and
// pushes that decision to the Outline server. It is called both by the
// periodic cron job (internal/cron) and immediately/synchronously by the HTTP
// handlers (e.g. right after a top-up), so behavior is identical either way.
package enforcement

import (
	"context"
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
