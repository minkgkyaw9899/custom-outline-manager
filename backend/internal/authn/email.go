package authn

import (
	"bytes"
	"crypto/tls"
	"fmt"
	"html/template"
	"net"
	"net/smtp"
	"strconv"
	"time"
)

type SMTPConfig struct {
	Host      string
	Port      int
	Username  string
	Password  string
	FromEmail string
	FromName  string
}

var otpEmailTemplate = template.Must(template.New("otp").Parse(`<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Figtree,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;overflow:hidden;border:1px solid #e4e4e7;">
            <tr>
              <td style="background-color:#2563eb;padding:24px 32px;">
                <span style="font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:700;color:#ffffff;">Invisigate VPN</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 8px;font-size:16px;color:#18181b;">Your sign-in code</p>
                <p style="margin:0 0 24px;font-size:14px;color:#71717a;">Use this code to finish signing in. It expires in {{.TTLMinutes}} minutes.</p>
                <div style="text-align:center;margin:0 0 24px;">
                  <span style="display:inline-block;padding:16px 24px;background-color:#eff6ff;border:1px solid #3b82f6;font-size:32px;font-weight:700;letter-spacing:8px;color:#2563eb;">{{.Code}}</span>
                </div>
                <p style="margin:0;font-size:13px;color:#a1a1aa;">If you didn't request this code, you can safely ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`))

// SendOTPEmail delivers a one-time code to toEmail via SMTP with STARTTLS.
// The whole operation (dial, handshake, auth, send) is bounded by timeout: a
// stalled connection to the SMTP host fails fast instead of hanging the
// request goroutine indefinitely — net/smtp.SendMail has no such bound, which
// is why this doesn't just call it directly.
func SendOTPEmail(cfg SMTPConfig, toEmail, code string, ttlMinutes int, timeout time.Duration) error {
	var body bytes.Buffer
	if err := otpEmailTemplate.Execute(&body, struct {
		Code       string
		TTLMinutes int
	}{Code: code, TTLMinutes: ttlMinutes}); err != nil {
		return fmt.Errorf("render otp email: %w", err)
	}

	from := fmt.Sprintf("%s <%s>", cfg.FromName, cfg.FromEmail)
	headers := fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: Your Invisigate VPN sign-in code\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n",
		from, toEmail,
	)
	msg := []byte(headers + body.String())

	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))

	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return fmt.Errorf("dial smtp server: %w", err)
	}
	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		conn.Close()
		return fmt.Errorf("set smtp deadline: %w", err)
	}

	client, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("create smtp client: %w", err)
	}
	defer client.Close()

	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{ServerName: cfg.Host}); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
	}

	if ok, _ := client.Extension("AUTH"); ok {
		auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}

	if err := client.Mail(cfg.FromEmail); err != nil {
		return fmt.Errorf("mail from: %w", err)
	}
	if err := client.Rcpt(toEmail); err != nil {
		return fmt.Errorf("rcpt to: %w", err)
	}

	// The handshake above (STARTTLS + AUTH) shares the connection's original
	// deadline, so on a slow path it can eat most of the budget before DATA
	// even starts — which is exactly what showed up in practice: MAIL/RCPT
	// succeeding and then DATA failing with "i/o timeout". Give the message
	// send its own fresh window rather than whatever's left over.
	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		return fmt.Errorf("reset smtp deadline: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		w.Close()
		return fmt.Errorf("write message: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("close data writer: %w", err)
	}
	return client.Quit()
}
