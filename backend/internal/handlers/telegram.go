package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

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
	if err != nil && !pushFailed {
		log.Printf("telegram webhook: renew key %s: %v", keyID, err)
		if ansErr := a.tg.AnswerCallbackQuery(ctx, cq.ID, "Failed to extend — check the dashboard"); ansErr != nil {
			log.Printf("telegram webhook: answer failed-renew callback: %v", ansErr)
		}
		return apiresponse.Success(c, nil, "ignored")
	}

	toastText := "Extended"
	messageText := "⚠️ Extended locally, but the change could not be pushed to the Outline server yet. It will retry on the next sync."
	if pushFailed {
		toastText = "Saved, but Outline push failed — will retry"
	} else {
		serverName := ""
		if server, srvErr := a.repo.GetServer(ctx, updated.ServerID); srvErr == nil {
			serverName = server.Name
		}
		messageText = extendedMessageText(*updated, serverName)
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
// been applied, so re-opening the chat shows the outcome instead of a stale
// "running low" warning with a now-dead button.
func extendedMessageText(key models.Key, serverName string) string {
	key = key.Enrich(time.Now())
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
	return fmt.Sprintf("✅ Extended <b>%s</b>\nServer: %s\n%s · %s", holder, serverName, remaining, daysLeft)
}
