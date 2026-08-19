// Package telegram is a minimal client for the Bot API surface this app
// needs: sending plain text alert and command-reply messages.
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

// Message is the minimal shape this app reads back from SendMessage.
type Message struct {
	MessageID int  `json:"message_id"`
	Chat      Chat `json:"chat"`
}

type Chat struct {
	ID int64 `json:"id"`
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

// SendMessage posts text to chatID and returns the sent message.
func (c *Client) SendMessage(ctx context.Context, chatID string, text string) (*Message, error) {
	payload := map[string]any{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}
	var msg Message
	if err := c.call(ctx, "sendMessage", payload, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
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
