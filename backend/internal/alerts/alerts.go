// Package alerts detects keys running low on data or close to expiry and
// posts a Telegram message for each. Entirely driven by the cron tick; inert
// whenever no Telegram client is configured.
package alerts

import (
	"context"
	"fmt"
	"log"
	"time"

	"outline-manager/internal/models"
	"outline-manager/internal/repository"
	"outline-manager/internal/telegram"
)

// debounceHours keeps a key that stays under threshold across multiple
// cron ticks from re-alerting every tick.
const debounceHours = 12

// Checker owns the low-usage/near-expiry sweep.
type Checker struct {
	repo   *repository.Repository
	tg     *telegram.Client
	chatID string
}

// New returns a Checker, or nil if Telegram isn't configured — callers should
// skip the sweep entirely in that case rather than call a no-op.
func New(repo *repository.Repository, tg *telegram.Client, chatID string) *Checker {
	if tg == nil || chatID == "" {
		return nil
	}
	return &Checker{repo: repo, tg: tg, chatID: chatID}
}

// Run finds every key newly under threshold, sends one alert message per key,
// and marks it alerted so the next tick's debounce window skips it. Errors
// for one key are logged and don't stop the sweep.
func (c *Checker) Run(ctx context.Context) {
	keys, err := c.repo.ListKeysNeedingLowUsageAlert(ctx, models.RunningLowRemainingBytes, models.RunningLowDaysLeft, debounceHours)
	if err != nil {
		log.Printf("alerts: list keys needing alert: %v", err)
		return
	}
	now := time.Now()
	for _, key := range keys {
		key = key.Enrich(now)
		text := alertText(key)
		if _, err := c.tg.SendMessage(ctx, c.chatID, text); err != nil {
			log.Printf("alerts: send message for key %s: %v", key.ID, err)
			continue
		}
		if err := c.repo.SetKeyLowUsageAlertSentAt(ctx, key.ID, now); err != nil {
			log.Printf("alerts: mark alert sent for key %s: %v", key.ID, err)
		}
	}
}

// SendDeviceAlerts posts one Telegram message per key CheckDeviceLimits
// flagged, and marks each as sent so the next sweep's debounce window holds.
// Informational only; the admin looks into it and decides what to do.
func (c *Checker) SendDeviceAlerts(ctx context.Context, flagged []models.DeviceAlert) {
	now := time.Now()
	for _, d := range flagged {
		holder := d.Key.UserName
		if holder == "" {
			holder = d.Key.Name
		}
		text := fmt.Sprintf(
			"👀 <b>%s</b> had %d devices connected at once in the last day\nServer: %s\nMight be shared beyond one person — check before assuming abuse.",
			holder, d.PeakDeviceCount, d.ServerName,
		)
		if _, err := c.tg.SendMessage(ctx, c.chatID, text); err != nil {
			log.Printf("alerts: send device alert for key %s: %v", d.Key.ID, err)
			continue
		}
		if err := c.repo.SetDeviceAlertSentAt(ctx, d.Key.ID, now); err != nil {
			log.Printf("alerts: mark device alert sent for key %s: %v", d.Key.ID, err)
		}
	}
}

func alertText(key models.Key) string {
	holder := key.UserName
	if holder == "" {
		holder = key.Name
	}
	remaining := "no limit"
	if key.RemainingBytes != nil {
		remaining = fmt.Sprintf("%.2f GB left", float64(*key.RemainingBytes)/models.BytesPerGB)
	}
	daysLeft := "no expiry"
	if key.DaysLeft != nil {
		daysLeft = fmt.Sprintf("%d day(s) left", *key.DaysLeft)
	}
	return fmt.Sprintf(
		"⚠️ <b>%s</b> is running low\nServer: %s\n%s · %s",
		holder, key.ServerName, remaining, daysLeft,
	)
}
