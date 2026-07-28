package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/alerts"
	"outline-manager/internal/apiresponse"
	"outline-manager/internal/enforcement"
	"outline-manager/internal/models"
)

// telegramWebhook receives every Telegram update for this bot. Two layers of
// verification gate an actual extend action: the X-Telegram-Bot-Api-Secret-Token
// header (proves the request came from Telegram's servers, or at least someone
// who knows the secret) and the callback's From.ID matching the one configured
// admin (proves it was that specific admin who tapped the button, since anyone
// added to the alert channel can see the message). Always responds 200 once
// the payload has been read, matching Telegram's expectation that a webhook
// acks quickly regardless of what it decided to do with the update.
func (a *API) telegramWebhook(c fiber.Ctx) error {
	if a.cfg.TelegramBotToken == "" || a.cfg.TelegramWebhookSecret == "" {
		return apiresponse.NotFound(c, "")
	}
	if c.Get("X-Telegram-Bot-Api-Secret-Token") != a.cfg.TelegramWebhookSecret {
		return apiresponse.Unauthorized(c, "")
	}

	var update struct {
		CallbackQuery *struct {
			ID   string `json:"id"`
			From struct {
				ID int64 `json:"id"`
			} `json:"from"`
			Message *struct {
				MessageID int `json:"message_id"`
				Chat      struct {
					ID int64 `json:"id"`
				} `json:"chat"`
			} `json:"message"`
			Data string `json:"data"`
		} `json:"callback_query"`
	}
	if err := json.Unmarshal(c.Body(), &update); err != nil {
		return apiresponse.Success(c, nil, "ignored")
	}

	cq := update.CallbackQuery
	if cq == nil {
		return apiresponse.Success(c, nil, "ignored")
	}

	ctx := c.Context()

	if cq.From.ID != a.cfg.TelegramAdminUserID {
		if err := a.tg.AnswerCallbackQuery(ctx, cq.ID, "Not authorized"); err != nil {
			log.Printf("telegram webhook: answer unauthorized callback: %v", err)
		}
		return apiresponse.Success(c, nil, "ignored")
	}

	keyID, ok := alerts.KeyIDFromCallbackData(cq.Data)
	if !ok {
		if err := a.tg.AnswerCallbackQuery(ctx, cq.ID, "Unrecognized action"); err != nil {
			log.Printf("telegram webhook: answer unrecognized callback: %v", err)
		}
		return apiresponse.Success(c, nil, "ignored")
	}

	updated, _, err := a.enforcer.RenewKey(ctx, keyID, alerts.ExtendAddGB, alerts.ExtendAddDays)
	pushFailed := errors.Is(err, enforcement.ErrPushFailed)

	var toastText, messageText string
	switch {
	case err != nil && !pushFailed:
		// The local save itself failed (bad key id, DB error, etc.) —
		// nothing was changed, so there's nothing to show but the failure.
		log.Printf("telegram webhook: renew key %s: %v", keyID, err)
		toastText = "Failed to extend"
		messageText = "❌ <b>Failed to extend</b>\nCould not renew this key — check the dashboard for details."
	default:
		// Saved locally either way; pushFailed only means the Outline server
		// hasn't picked it up yet (next cron tick retries), so the figures
		// below are still accurate.
		serverName := ""
		if server, srvErr := a.repo.GetServer(ctx, updated.ServerID); srvErr == nil {
			serverName = server.Name
		}
		messageText = extendedMessageText(*updated, serverName)
		if pushFailed {
			toastText = "Saved, but Outline push failed — will retry"
			messageText += "\n\n⚠️ Could not push this to the Outline server yet; it will retry on the next sync."
		} else {
			toastText = "Extended"
		}
	}

	if ansErr := a.tg.AnswerCallbackQuery(ctx, cq.ID, toastText); ansErr != nil {
		log.Printf("telegram webhook: answer callback: %v", ansErr)
	}
	if cq.Message != nil {
		if editErr := a.tg.EditMessageText(ctx, cq.Message.Chat.ID, cq.Message.MessageID, messageText); editErr != nil {
			log.Printf("telegram webhook: edit message: %v", editErr)
		}
	}

	return apiresponse.Success(c, nil, "ok")
}

// extendedMessageText replaces the original alert once the extend action has
// been applied, so re-opening the chat shows the outcome (used/total quota,
// new expiry date) instead of a stale "running low" warning with a now-dead
// button.
func extendedMessageText(key models.Key, serverName string) string {
	quota := fmt.Sprintf("%s used, no limit", formatGB(key.UsedBytes))
	if key.CustomLimitBytes != nil {
		quota = fmt.Sprintf("%s/%s GB", formatGB(key.UsedBytes), formatGB(*key.CustomLimitBytes))
	}
	expiry := "no expiry"
	if key.EndDate != nil {
		expiry = "ends on " + key.EndDate.Format("02-Jan-2006")
	}
	holder := key.UserName
	if holder == "" {
		holder = key.Name
	}
	return fmt.Sprintf("✅ <b>Extended %s</b>\nServer: %s\n%s, %s", holder, serverName, quota, expiry)
}

// formatGB renders bytes as a plain GB number (no unit suffix — callers
// combine two of these into one "x/y GB" string).
func formatGB(bytes int64) string {
	return fmt.Sprintf("%.1f", float64(bytes)/models.BytesPerGB)
}
