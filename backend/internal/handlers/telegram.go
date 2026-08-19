package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
	"outline-manager/internal/models"
)

// telegramWebhook receives every Telegram update for this bot. Two layers of
// verification gate anything this handler does: the X-Telegram-Bot-Api-Secret-Token
// header (proves the request came from Telegram's servers, or at least someone
// who knows the secret) and the sender's id matching the one configured admin
// (proves it was that specific admin, since anyone added to the alert channel
// can see the messages). Always responds 200 once the payload has been read,
// matching Telegram's expectation that a webhook acks quickly regardless of
// what it decided to do with the update. Only plain text messages (slash
// commands) are handled.
func (a *API) telegramWebhook(c fiber.Ctx) error {
	if a.cfg.TelegramBotToken == "" || a.cfg.TelegramWebhookSecret == "" {
		return apiresponse.NotFound(c, "")
	}
	if c.Get("X-Telegram-Bot-Api-Secret-Token") != a.cfg.TelegramWebhookSecret {
		return apiresponse.Unauthorized(c, "")
	}

	var update struct {
		Message *struct {
			Chat struct {
				ID int64 `json:"id"`
			} `json:"chat"`
			From struct {
				ID int64 `json:"id"`
			} `json:"from"`
			Text string `json:"text"`
		} `json:"message"`
	}
	if err := json.Unmarshal(c.Body(), &update); err != nil {
		return apiresponse.Success(c, nil, "ignored")
	}

	ctx := c.Context()

	// A plain text message is a read-only slash command (/servers, /find).
	if update.Message == nil {
		return apiresponse.Success(c, nil, "ignored")
	}
	if update.Message.From.ID != a.cfg.TelegramAdminUserID {
		return apiresponse.Success(c, nil, "ignored")
	}
	if err := a.handleTelegramCommand(ctx, update.Message.Chat.ID, update.Message.Text); err != nil {
		log.Printf("telegram webhook: handle command %q: %v", update.Message.Text, err)
	}
	return apiresponse.Success(c, nil, "ok")
}

// telegramFindResultLimit caps how many matches /find sends in one message —
// a name search on a mistyped or very short query could otherwise match most
// of the key list and blow past Telegram's message length limits.
const telegramFindResultLimit = 15

// handleTelegramCommand dispatches a slash command from the admin's DM with
// the bot. Read-only: nothing here changes a key, server, or user — the
// dashboard is still where that happens. Errors talking to Telegram itself
// are returned for the caller to log; everything else (bad command, no
// matches) is reported back to the chat instead.
func (a *API) handleTelegramCommand(ctx context.Context, chatID int64, text string) error {
	fields := strings.Fields(strings.TrimSpace(text))
	if len(fields) == 0 {
		return nil
	}
	command := strings.ToLower(fields[0])
	// Telegram allows "/command@BotUsername" in group chats; the admin only
	// ever DMs the bot, but stripping it is free and avoids a silent miss.
	if i := strings.Index(command, "@"); i != -1 {
		command = command[:i]
	}
	arg := strings.TrimSpace(strings.TrimPrefix(text, fields[0]))

	var reply string
	switch command {
	case "/servers":
		reply = a.telegramServersReply(ctx)
	case "/find":
		reply = a.telegramFindReply(ctx, arg)
	case "/start", "/help":
		reply = "Commands:\n/servers — sync status of every server\n/find &lt;name&gt; — look up a key or holder by name"
	default:
		reply = "Unrecognized command. Send /help to see what's available."
	}

	_, err := a.tg.SendMessage(ctx, fmt.Sprintf("%d", chatID), reply)
	return err
}

func (a *API) telegramServersReply(ctx context.Context) string {
	servers, err := a.repo.ListAllServers(ctx)
	if err != nil {
		return "Could not load servers — check the dashboard."
	}
	if len(servers) == 0 {
		return "No servers added yet."
	}
	var b strings.Builder
	b.WriteString("<b>Servers</b>\n")
	for _, s := range servers {
		status := "✅ synced"
		if s.LastSyncError != nil {
			status = "❌ " + *s.LastSyncError
		} else if s.LastSyncedAt == nil {
			status = "⏳ never synced"
		}
		fmt.Fprintf(&b, "\n<b>%s</b>\n%s\n", s.Name, status)
	}
	return b.String()
}

func (a *API) telegramFindReply(ctx context.Context, query string) string {
	if query == "" {
		return "Usage: /find &lt;name&gt; — matches a key name or holder name."
	}
	keys, err := a.repo.ListAllKeys(ctx)
	if err != nil {
		return "Could not search keys — check the dashboard."
	}
	needle := strings.ToLower(query)
	now := time.Now()
	var b strings.Builder
	matches := 0
	for _, key := range keys {
		if !strings.Contains(strings.ToLower(key.Name), needle) &&
			!strings.Contains(strings.ToLower(key.UserName), needle) {
			continue
		}
		if matches >= telegramFindResultLimit {
			b.WriteString("\n…more matches than fit here — narrow the search or use the dashboard.")
			break
		}
		matches++
		key = key.Enrich(now)
		holder := key.UserName
		if holder == "" {
			holder = key.Name
		}
		quota := fmt.Sprintf("%s used, no limit", formatGB(key.UsedBytes))
		if key.CustomLimitBytes != nil {
			quota = fmt.Sprintf("%s/%s GB", formatGB(key.UsedBytes), formatGB(*key.CustomLimitBytes))
		}
		expiry := "no expiry"
		if key.EndDate != nil {
			expiry = key.EndDate.Format("02-Jan-2006")
		}
		fmt.Fprintf(&b, "\n<b>%s</b> — %s\n%s · %s · expires %s\n", holder, key.ServerName, quota, key.Status, expiry)
	}
	if matches == 0 {
		return fmt.Sprintf("No key or holder matching %q.", query)
	}
	return b.String()
}

// formatGB renders bytes as a plain GB number (no unit suffix — callers
// combine two of these into one "x/y GB" string).
func formatGB(bytes int64) string {
	return fmt.Sprintf("%.1f", float64(bytes)/models.BytesPerGB)
}
