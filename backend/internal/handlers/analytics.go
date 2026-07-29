package handlers

import (
	"strconv"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
)

const defaultRetentionWindowDays = 30

// getRetentionAnalytics answers "who's about to not renew" — renewal-lapse
// rate, holder churn, new-holder trend, and average active-holder tenure
// over ?days= (default 30). See models.RetentionMetrics for why there is no
// currency-denominated LTV here.
func (a *API) getRetentionAnalytics(c fiber.Ctx) error {
	days := defaultRetentionWindowDays
	if raw := c.Query("days"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "days", Message: "must be a positive integer"})
		}
		days = parsed
	}

	metrics, err := a.repo.RetentionMetrics(c.Context(), days)
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	return apiresponse.Success(c, metrics, "")
}
