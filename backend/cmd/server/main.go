// Command server is the entrypoint for the Outline multi-server management
// API: it runs the REST API, optionally serves the built frontend, and runs
// the background enforcement cron, all in a single process.
package main

import (
	"context"
	"errors"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/logger"
	"github.com/gofiber/fiber/v3/middleware/recover"

	"outline-manager/internal/alerts"
	"outline-manager/internal/apiresponse"
	"outline-manager/internal/config"
	"outline-manager/internal/cron"
	"outline-manager/internal/db"
	"outline-manager/internal/enforcement"
	"outline-manager/internal/handlers"
	"outline-manager/internal/outline"
	"outline-manager/internal/repository"
	"outline-manager/internal/telegram"
)

// telegramHTTPTimeout bounds every call to the Bot API so a stalled request
// can't hang a cron tick or a webhook handler indefinitely.
const telegramHTTPTimeout = 10 * time.Second

// shutdownGrace is how long in-flight requests get to finish after SIGTERM.
const shutdownGrace = 10 * time.Second

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	if err := db.Migrate(ctx, pool); err != nil {
		log.Fatalf("db migrate: %v", err)
	}

	repo := repository.New(pool)
	clientCache := outline.NewCache(cfg.OutlineHTTPTimeout)
	enforcer := enforcement.New(repo, clientCache)

	var tg *telegram.Client
	if cfg.TelegramBotToken != "" {
		tg = telegram.New(cfg.TelegramBotToken, telegramHTTPTimeout)
		registerTelegramWebhook(ctx, cfg, tg)
	}

	cronJob := cron.New(repo, enforcer, alerts.New(repo, tg, cfg.TelegramChatID))
	if err := cronJob.Start(cfg.CronInterval); err != nil {
		log.Fatalf("start cron: %v", err)
	}
	defer cronJob.Stop()

	app := newApp(cfg, repo, clientCache, enforcer, tg)

	go func() {
		log.Printf("listening on :%s (static dir: %s)", cfg.Port, cfg.StaticDir)
		if err := app.Listen(":"+cfg.Port, fiber.ListenConfig{DisableStartupMessage: true}); err != nil {
			log.Fatalf("http server: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down...")

	if err := app.ShutdownWithTimeout(shutdownGrace); err != nil && !errors.Is(err, fiber.ErrNotRunning) {
		log.Printf("http shutdown: %v", err)
	}
}

// registerTelegramWebhook points Telegram at this server's webhook endpoint.
// Safe to call on every boot: Telegram no-ops if the URL is already set to
// the same value. Skipped (with a log line, not a fatal error) if
// TELEGRAM_WEBHOOK_URL or the webhook secret isn't configured — the bot can
// still send alerts either way, it just won't receive button-press callbacks.
func registerTelegramWebhook(ctx context.Context, cfg *config.Config, tg *telegram.Client) {
	if cfg.TelegramWebhookURL == "" || cfg.TelegramWebhookSecret == "" {
		log.Println("telegram: TELEGRAM_WEBHOOK_URL or TELEGRAM_WEBHOOK_SECRET not set; skipping webhook registration (alerts will still send, but extend buttons won't work)")
		return
	}
	if err := tg.SetWebhook(ctx, cfg.TelegramWebhookURL, cfg.TelegramWebhookSecret); err != nil {
		log.Printf("telegram: set webhook: %v", err)
	}
}

// newApp assembles the middleware stack, the JSON API, and the static
// frontend fallback.
func newApp(cfg *config.Config, repo *repository.Repository, cache *outline.Cache, enforcer *enforcement.Enforcer, tg *telegram.Client) *fiber.App {
	app := fiber.New(fiber.Config{
		StructValidator: handlers.StructValidator{},
		ErrorHandler:    apiErrorHandler,
	})

	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOriginsFunc: func(origin string) bool {
			return isAllowedOrigin(cfg.AllowedOrigins, origin)
		},
		AllowCredentials: true,
		AllowHeaders:     []string{"Content-Type", "Authorization"},
	}))
	app.Use(handlers.Timeout(cfg.RequestTimeout))

	api := handlers.New(repo, cache, enforcer, cfg, tg)
	api.RegisterRoutes(app)

	// Anything not matched by the API is handed to the frontend, with an
	// index.html fallback so client-side routes survive a hard refresh.
	app.Use(handlers.StaticHandler(cfg.StaticDir))

	return app
}

// isAllowedOrigin reports whether origin may receive credentialed CORS
// responses: either it's in allowedOrigins verbatim, or allowedOrigins
// contains the wildcard. Credentials still require echoing the exact origin
// (never "*"), which cors.Config's AllowOriginsFunc handles for us.
func isAllowedOrigin(allowedOrigins []string, origin string) bool {
	for _, o := range allowedOrigins {
		if o == "*" || o == origin {
			return true
		}
	}
	return false
}

// apiErrorHandler is the last-resort envelope for anything that reaches Fiber
// as a returned/panicked error instead of going through internal/apiresponse
// directly: a recovered panic, or Fiber's own routing errors (e.g. no route
// matched, though StaticHandler is registered to catch that first).
func apiErrorHandler(c fiber.Ctx, err error) error {
	code := 500
	var fiberErr *fiber.Error
	if errors.As(err, &fiberErr) && fiberErr != nil {
		code = fiberErr.Code
	}
	if code == 404 {
		return apiresponse.NotFound(c, "No such endpoint")
	}
	log.Printf("unhandled error: %v", err)
	return apiresponse.Internal(c, "")
}
