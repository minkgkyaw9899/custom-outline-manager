// Package cron runs the periodic Outline sync + enforcement job.
package cron

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/robfig/cron/v3"

	"outline-manager/internal/alerts"
	"outline-manager/internal/enforcement"
	"outline-manager/internal/repository"
)

// perServerTimeout caps how long one server may hold up a sync pass. An
// unreachable server otherwise blocks every server behind it in the loop for
// the full TCP timeout.
const perServerTimeout = 2 * time.Minute

type Job struct {
	repo      *repository.Repository
	enforcer  *enforcement.Enforcer
	scheduler *cron.Cron
	// alertChecker is nil whenever Telegram alerting isn't configured; RunOnce
	// skips the sweep entirely in that case.
	alertChecker *alerts.Checker

	// ctx is the lifetime of the process; cancelling it makes in-flight syncs
	// return instead of running past shutdown.
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func New(repo *repository.Repository, enforcer *enforcement.Enforcer, alertChecker *alerts.Checker) *Job {
	ctx, cancel := context.WithCancel(context.Background())
	return &Job{
		repo:         repo,
		enforcer:     enforcer,
		alertChecker: alertChecker,
		scheduler:    cron.New(),
		ctx:          ctx,
		cancel:       cancel,
	}
}

// Start schedules RunOnce on the given interval and kicks off one run
// immediately in the background so freshly-added servers don't wait a full
// interval before their first sync.
func (j *Job) Start(interval time.Duration) error {
	_, err := j.scheduler.AddFunc("@every "+interval.String(), j.run)
	if err != nil {
		return err
	}
	j.scheduler.Start()

	go j.run()
	return nil
}

// Stop halts the scheduler, cancels any in-flight sync, and waits for it.
func (j *Job) Stop() {
	ctx := j.scheduler.Stop() // stops scheduling; ctx closes when jobs return
	j.cancel()
	<-ctx.Done()
	j.wg.Wait()
}

func (j *Job) run() {
	j.wg.Add(1)
	defer j.wg.Done()
	j.RunOnce(j.ctx)
}

// RunOnce syncs and enforces every configured server. One server's failure
// (unreachable, bad cert, etc.) is logged and does not stop the others.
func (j *Job) RunOnce(ctx context.Context) {
	servers, err := j.repo.ListAllServers(ctx)
	if err != nil {
		log.Printf("cron: list servers: %v", err)
		return
	}

	log.Printf("cron: starting sync of %d server(s)", len(servers))
	for _, s := range servers {
		if ctx.Err() != nil {
			log.Printf("cron: sync cancelled")
			return
		}
		serverCtx, cancel := context.WithTimeout(ctx, perServerTimeout)
		if err := j.enforcer.SyncServer(serverCtx, s); err != nil {
			log.Printf("cron: %v", err)
		}
		cancel()
	}

	// One snapshot per tick, after every server has had a chance to sync, so
	// today's revenue reading reflects the freshest key/price data available.
	if err := j.repo.SnapshotRevenue(ctx); err != nil {
		log.Printf("cron: snapshot revenue: %v", err)
	}

	// Also after every server has synced, so this tick's bandwidth check uses
	// fresh usage snapshots rather than the previous tick's.
	j.enforcer.CheckBandwidthLimits(ctx)

	// Low-usage/near-expiry Telegram alerts, last, using this tick's freshest
	// usage figures.
	if j.alertChecker != nil {
		j.alertChecker.Run(ctx)
	}

	log.Printf("cron: sync complete")
}
