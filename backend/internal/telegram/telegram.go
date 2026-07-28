// Package telegram is a minimal client for the Bot API surface this app
// needs: sending an alert message with an inline button, acknowledging a
// button press, and editing a message afterward to show the result.
package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const apiBase = "https://api.telegram.org"

// Client talks to the Bot API for one bot token.
type Client struct {
	token      string
	httpClient *http.Client
}

func New(token string, timeout time.Duration) *Client {
	return &Client{token: token, httpClient: &http.Client{Timeout: timeout}}
}

// InlineKeyboardButton is one button on a message. CallbackData round-trips
// back to the webhook in the resulting CallbackQuery.
type InlineKeyboardButton struct {
	Text         string `json:"text"`
	CallbackData string `json:"callback_data"`
}

type InlineKeyboardMarkup struct {
	InlineKeyboard [][]InlineKeyboardButton `json:"inline_keyboard"`
}

// Message is the minimal shape this app reads back from SendMessage and from
// the CallbackQuery.Message field.
type Message struct {
	MessageID int  `json:"message_id"`
	Chat      Chat `json:"chat"`
}

type Chat struct {
	ID int64 `json:"id"`
}

type User struct {
	ID int64 `json:"id"`
}

// CallbackQuery is what Telegram sends when someone taps an inline button.
type CallbackQuery struct {
	ID      string   `json:"id"`
	From    User     `json:"from"`
	Message *Message `json:"message"`
	Data    string   `json:"data"`
}

// Update is the webhook payload shape. Only the fields this app reads.
type Update struct {
	UpdateID      int64          `json:"update_id"`
	CallbackQuery *CallbackQuery `json:"callback_query"`
}

type apiResponse[T any] struct {
	OK          bool   `json:"ok"`
	Description string `json:"description"`
	Result      T      `json:"result"`
}

func (c *Client) call(ctx context.Context, method string, payload any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("telegram: marshal %s: %w", method, err)
	}
	url := fmt.Sprintf("%s/bot%s/%s", apiBase, c.token, method)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("telegram: build request for %s: %w", method, err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("telegram: call %s: %w", method, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("telegram: read %s response: %w", method, err)
	}

	var parsed apiResponse[json.RawMessage]
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return fmt.Errorf("telegram: decode %s response: %w", method, err)
	}
	if !parsed.OK {
		return fmt.Errorf("telegram: %s rejected: %s", method, parsed.Description)
	}
	if out != nil {
		if err := json.Unmarshal(parsed.Result, out); err != nil {
			return fmt.Errorf("telegram: decode %s result: %w", method, err)
		}
	}
	return nil
}

// SendMessage posts text to chatID, optionally with an inline keyboard, and
// returns the sent message (its id is needed later to edit it in place).
func (c *Client) SendMessage(ctx context.Context, chatID string, text string, markup *InlineKeyboardMarkup) (*Message, error) {
	payload := map[string]any{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}
	if markup != nil {
		payload["reply_markup"] = markup
	}
	var msg Message
	if err := c.call(ctx, "sendMessage", payload, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// EditMessageText replaces a previously-sent message's text — used to append
// the outcome ("Extended ...") once a button press has been handled, and to
// drop the button itself (an omitted reply_markup clears it).
func (c *Client) EditMessageText(ctx context.Context, chatID int64, messageID int, text string) error {
	return c.call(ctx, "editMessageText", map[string]any{
		"chat_id":    chatID,
		"message_id": messageID,
		"text":       text,
		"parse_mode": "HTML",
	}, nil)
}

// AnswerCallbackQuery stops the button's loading spinner on the tapper's
// device and optionally shows them a small toast. Telegram requires this be
// called for every callback query, answered or not.
func (c *Client) AnswerCallbackQuery(ctx context.Context, callbackQueryID, text string) error {
	return c.call(ctx, "answerCallbackQuery", map[string]any{
		"callback_query_id": callbackQueryID,
		"text":              text,
	}, nil)
}

// SetWebhook registers url as the target for update delivery. secretToken, if
// non-empty, is echoed back on every delivered update as the
// X-Telegram-Bot-Api-Secret-Token header, letting the receiver reject
// requests that don't know it. Safe to call on every boot — Telegram no-ops
// if the webhook is already set to the same URL.
func (c *Client) SetWebhook(ctx context.Context, url, secretToken string) error {
	payload := map[string]any{"url": url}
	if secretToken != "" {
		payload["secret_token"] = secretToken
	}
	return c.call(ctx, "setWebhook", payload, nil)
}
