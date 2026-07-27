package handlers

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
)

// StaticHandler serves the frontend out of dir, falling back to index.html for
// any path that isn't a real file. That fallback is what makes client-side
// routing work: a hard refresh on /servers/abc must still return the app shell
// rather than a 404. Requests under /api are never rewritten, so a wrong API
// path returns JSON-shaped 404s instead of HTML.
//
// If dir doesn't exist (an API-only deployment, or the frontend hasn't been
// built yet) every request gets a standardized 404 explaining why. Register
// this last, as catch-all middleware (app.Use), so it only runs for requests
// no earlier route matched.
func StaticHandler(dir string) fiber.Handler {
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return func(c fiber.Ctx) error {
			return apiresponse.NotFound(c, "No frontend build found at "+dir+" (set STATIC_DIR, or build the frontend)")
		}
	}

	index := filepath.Join(dir, "index.html")

	return func(c fiber.Ctx) error {
		reqPath := c.Path()

		if strings.HasPrefix(reqPath, "/api/") {
			return apiresponse.NotFound(c, "No such endpoint")
		}

		if full, ok := resolveStaticFile(dir, reqPath); ok {
			return c.SendFile(full)
		}
		return c.SendFile(index)
	}
}

// resolveStaticFile reports the on-disk path for reqPath if it resolves to a
// real file inside dir.
func resolveStaticFile(dir, reqPath string) (string, bool) {
	clean := filepath.Clean("/" + strings.TrimPrefix(reqPath, "/"))
	full := filepath.Join(dir, clean)

	// filepath.Clean on a rooted path already strips ".." traversal, but check
	// the resolved path is still under dir before touching the filesystem.
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return "", false
	}
	absFull, err := filepath.Abs(full)
	if err != nil || !strings.HasPrefix(absFull, absDir) {
		return "", false
	}

	info, err := os.Stat(absFull)
	if err != nil || info.IsDir() {
		return "", false
	}
	return absFull, true
}
