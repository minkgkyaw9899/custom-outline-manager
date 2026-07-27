package handlers

import (
	"context"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/models"
	"outline-manager/internal/repository"
)

// dynamicKeyResponse is the "legacy" JSON shape of an Outline dynamic access
// key's resolved connection info — see
// https://developer.getoutline.org/vpn/management/dynamic-access-keys.
type dynamicKeyResponse struct {
	Server     string `json:"server"`
	ServerPort int    `json:"server_port"`
	Password   string `json:"password"`
	Method     string `json:"method"`
}

// resolveDynamicToken finds the key a dynamic access token points at.
//
// A token belongs either to a *user* — the link handed out today, which
// resolves through whichever key they currently hold — or to a *key*, which is
// what links issued before the user model existed carry. User tokens are tried
// first because they are the ones in circulation; key tokens keep working so
// that nobody who was already given one has to be re-issued.
func (a *API) resolveDynamicToken(ctx context.Context, token string) (*models.Key, error) {
	user, err := a.repo.GetUserByDynamicToken(ctx, token)
	if err == nil {
		if user.PrimaryKeyID == nil {
			return nil, repository.ErrNotFound
		}
		return a.repo.GetKey(ctx, *user.PrimaryKeyID)
	}
	return a.repo.GetKeyByDynamicToken(ctx, token)
}

// dynamicKey resolves a dynamic access token (the ssconf:// link's path, see
// models.DynamicAccessURL) to live connection info. It is fetched directly by
// the Outline client apps, not this dashboard's own frontend, so it
// deliberately bypasses apiresponse's {success,data,...} envelope and returns
// exactly the four fields the client expects.
//
// Public and unauthenticated by design: the token itself is the credential,
// exactly like a static ss:// key's embedded password, and an Outline client
// has no way to carry an admin session's OTP/JWT. A disabled, expired, or
// over-quota key still resolves here rather than 404ing — Outline itself
// already refuses the connection because the enforcement reconciler pushes a
// 0-byte data limit for such keys, so there is nothing extra to enforce at
// this layer, and a stable resolution lets the same link start working again
// the moment the key is renewed.
//
// Because the token in circulation belongs to the user, an admin can move
// someone to a different server or reissue their key and every client already
// configured with this link picks up the new connection on its next refresh.
func (a *API) dynamicKey(c fiber.Ctx) error {
	key, err := a.resolveDynamicToken(c.Context(), c.Params("token"))
	if err != nil || key.Port == nil || key.Method == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
	}
	server, err := a.repo.GetServer(c.Context(), key.ServerID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
	}

	// Never cache: a key's port/method are fixed for its lifetime, but the
	// admin can delete or re-provision it, and stale intermediary caching
	// would keep serving a dead key's old config.
	c.Set("Cache-Control", "no-store")
	return c.Status(fiber.StatusOK).JSON(dynamicKeyResponse{
		Server:     server.Hostname(),
		ServerPort: *key.Port,
		Password:   key.Password,
		Method:     *key.Method,
	})
}
