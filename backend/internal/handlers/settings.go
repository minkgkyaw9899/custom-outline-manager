package handlers

import (
	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
)

// getSettings returns the full admin-editable settings row, including
// mmk_per_usd — an internal cost figure never exposed on the public
// endpoint below.
func (a *API) getSettings(c fiber.Ctx) error {
	settings, err := a.repo.GetSettings(c.Context())
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	return apiresponse.Success(c, settings, "")
}

type updateSettingsRequest struct {
	MmkPerUsd      float64  `json:"mmkPerUsd" validate:"required,gt=0"`
	PaymentPhone   string   `json:"paymentPhone" validate:"required"`
	PaymentWallets []string `json:"paymentWallets" validate:"required,min=1,dive,required"`
}

func (a *API) updateSettings(c fiber.Ctx) error {
	var req updateSettingsRequest
	if !bindJSON(c, &req) {
		return nil
	}

	settings, err := a.repo.UpdateSettings(c.Context(), req.MmkPerUsd, req.PaymentPhone, req.PaymentWallets)
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	return apiresponse.Success(c, settings, "Settings updated")
}

// getPublicPaymentInfo is fetched by the unauthenticated /order page to show
// customers where to send payment. Deliberately a separate, narrower
// endpoint from getSettings rather than a public flag on the same one, so
// mmk_per_usd (an internal cost figure) can never leak through it by a
// future field getting added without a second thought.
func (a *API) getPublicPaymentInfo(c fiber.Ctx) error {
	settings, err := a.repo.GetSettings(c.Context())
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	return apiresponse.Success(c, settings.Public(), "")
}
