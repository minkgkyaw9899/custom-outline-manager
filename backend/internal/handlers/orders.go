package handlers

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
	"outline-manager/internal/models"
)

// getPublicServers is the public order page's server/location picker — name
// only, never api_url/cert_sha256/cost, unlike GET /servers (protected).
func (a *API) getPublicServers(c fiber.Ctx) error {
	servers, err := a.repo.ListPublicServers(c.Context())
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	return apiresponse.Success(c, servers, "")
}

type createOrderRequest struct {
	CustomerName  string  `json:"customerName" validate:"required,max=120"`
	Contact       string  `json:"contact" validate:"required,max=200"`
	ServerID      string  `json:"serverId" validate:"required"`
	PlanGB        float64 `json:"planGb"`
	PlanDays      int     `json:"planDays"`
	PaymentMethod string  `json:"paymentMethod" validate:"required,max=60"`
	CustomerNote  string  `json:"customerNote" validate:"max=500"`
}

// createOrder is the public, unauthenticated order-submission endpoint.
// Payment is manual — nothing here verifies a transfer happened, it just
// records the request and pings the admin on Telegram (if configured) so
// they can review and approve it from the admin Orders page.
func (a *API) createOrder(c fiber.Ctx) error {
	var req createOrderRequest
	if !bindJSON(c, &req) {
		return nil
	}

	server, err := a.repo.GetServer(c.Context(), strings.TrimSpace(req.ServerID))
	if err != nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "serverId", Message: "That server does not exist"})
	}

	// Same plan-floor enforcement as every other create/renew path — reject
	// a below-minimum request rather than silently rounding it up.
	planGB, planDays := req.PlanGB, req.PlanDays
	if ferr := applyPlanMinimums(&planGB, &planDays); ferr != nil {
		return apiresponse.Validation(c, *ferr)
	}

	order, err := a.repo.CreateOrder(c.Context(), models.Order{
		CustomerName:  strings.TrimSpace(req.CustomerName),
		Contact:       strings.TrimSpace(req.Contact),
		ServerID:      &server.ID,
		PlanGB:        planGB,
		PlanDays:      planDays,
		PaymentMethod: strings.TrimSpace(req.PaymentMethod),
		CustomerNote:  strings.TrimSpace(req.CustomerNote),
	})
	if err != nil {
		return apiresponse.Internal(c, "")
	}

	a.notifyNewOrder(c.Context(), *order)

	return apiresponse.Created(c, order, "Order submitted — you'll be contacted once it's confirmed")
}

func (a *API) notifyNewOrder(ctx context.Context, order models.Order) {
	if a.tg == nil || a.cfg.TelegramChatID == "" {
		return
	}
	serverName := "unknown server"
	if order.ServerName != nil {
		serverName = *order.ServerName
	}
	text := fmt.Sprintf(
		"🛒 <b>New order</b>\n%s (%s)\n%s · %.0f GB / %d days\nPayment: %s\nReview it in the admin Orders page.",
		order.CustomerName, order.Contact, serverName, order.PlanGB, order.PlanDays, order.PaymentMethod,
	)
	if _, err := a.tg.SendMessage(ctx, a.cfg.TelegramChatID, text, nil); err != nil {
		log.Printf("notify new order %s: %v", order.ID, err)
	}
}

// listOrders returns every order, optionally filtered to one status (the
// admin Orders page's pending queue passes ?status=pending).
func (a *API) listOrders(c fiber.Ctx) error {
	status := models.OrderStatus(c.Query("status"))
	orders, err := a.repo.ListOrders(c.Context(), status)
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	return apiresponse.Success(c, orders, "")
}

func (a *API) getOrder(c fiber.Ctx) error {
	order, err := a.repo.GetOrder(c.Context(), c.Params("id"))
	if err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.Success(c, order, "")
}

type approveOrderRequest struct {
	// ServerID overrides the order's own server, in case the admin wants to
	// provision somewhere else than what the customer picked. Plan figures
	// likewise default to the order's own but can be adjusted before approval.
	ServerID string  `json:"serverId"`
	PlanGB   float64 `json:"planGb"`
	PlanDays int     `json:"planDays"`
}

// approveOrder provisions a user+key using the exact same internal calls
// createUser's fresh-provision path uses (resolveKeyPlan, a.provisionKey) —
// this is not a new provisioning path, it's the existing one called
// directly instead of over HTTP. An order approval is the admin confirming
// they've verified the manual payment; there is nothing further to log
// beyond the order's own price_mmk/payment_method — same as any other
// "add user with key" admin action, which never writes a renewal_logs row
// for a key's initial creation either.
func (a *API) approveOrder(c fiber.Ctx) error {
	order, err := a.repo.GetOrder(c.Context(), c.Params("id"))
	if err != nil {
		return respondRepoErr(c, err)
	}
	if order.Status != models.OrderStatusPending {
		return apiresponse.Conflict(c, "This order has already been decided")
	}

	var req approveOrderRequest
	if !bindJSON(c, &req) {
		return nil
	}

	serverID := strings.TrimSpace(req.ServerID)
	if serverID == "" && order.ServerID != nil {
		serverID = *order.ServerID
	}
	if serverID == "" {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "serverId", Message: "A server is required"})
	}
	server, err := a.repo.GetServer(c.Context(), serverID)
	if err != nil {
		return apiresponse.Validation(c, apiresponse.FieldError{Field: "serverId", Message: "That server does not exist"})
	}

	planGB, planDays := req.PlanGB, req.PlanDays
	if planGB == 0 {
		planGB = order.PlanGB
	}
	if planDays == 0 {
		planDays = order.PlanDays
	}
	plan, ferr := resolveKeyPlan(*server, planGB, planDays)
	if ferr != nil {
		return apiresponse.Validation(c, *ferr)
	}

	user, err := a.repo.CreateUser(c.Context(), order.CustomerName, "Self-serve order — "+order.PaymentMethod, models.UserStatusActive)
	if err != nil {
		return respondRepoErr(c, err)
	}

	key, err := a.provisionKey(c.Context(), *server, order.CustomerName, plan, &user.ID)
	if err != nil {
		a.discardUser(user.ID)
		return respondProvisionErr(c, *server, err)
	}
	if err := a.repo.AdoptPrimaryKeyIfUnset(c.Context(), user.ID, key.ID); err != nil {
		return respondRepoErr(c, err)
	}

	updated, err := a.repo.DecideOrder(c.Context(), order.ID, models.OrderStatusApproved, nil, &user.ID, &key.ID)
	if err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.Success(c, updated, "Order approved — "+user.Name+" was given a key")
}

type rejectOrderRequest struct {
	AdminNote string `json:"adminNote" validate:"max=500"`
}

func (a *API) rejectOrder(c fiber.Ctx) error {
	order, err := a.repo.GetOrder(c.Context(), c.Params("id"))
	if err != nil {
		return respondRepoErr(c, err)
	}
	if order.Status != models.OrderStatusPending {
		return apiresponse.Conflict(c, "This order has already been decided")
	}

	var req rejectOrderRequest
	if !bindJSON(c, &req) {
		return nil
	}
	note := strings.TrimSpace(req.AdminNote)

	updated, err := a.repo.DecideOrder(c.Context(), order.ID, models.OrderStatusRejected, &note, nil, nil)
	if err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.Success(c, updated, "Order rejected")
}
