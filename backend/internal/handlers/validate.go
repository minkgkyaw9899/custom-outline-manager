package handlers

import (
	"errors"
	"fmt"
	"reflect"
	"strings"

	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
)

// bodyValidator backs the fiber.StructValidator plugged into the app config
// in main.go, so c.Bind().Body(dst) validates as well as decodes.
var bodyValidator = validator.New(validator.WithRequiredStructEnabled())

// init registers a tag-name function so validator field errors report the
// JSON tag (e.g. "apiUrl") instead of the Go struct field name (e.g.
// "APIURL"), which is what request bodies and the frontend's field-error
// binding actually use.
func init() {
	bodyValidator.RegisterTagNameFunc(func(fld reflect.StructField) string {
		name := strings.SplitN(fld.Tag.Get("json"), ",", 2)[0]
		if name == "-" || name == "" {
			return fld.Name
		}
		return name
	})
}

// StructValidator adapts bodyValidator to fiber.StructValidator, for
// fiber.Config.StructValidator.
type StructValidator struct{}

func (StructValidator) Validate(out any) error {
	return bodyValidator.Struct(out)
}

// bindJSON decodes and validates the request body, writing a standardized
// VALIDATION_ERROR envelope (with one field-level detail per failed rule) and
// returning false if binding fails. Handlers should return immediately when
// this returns false.
func bindJSON(c fiber.Ctx, dst any) bool {
	if err := c.Bind().Body(dst); err != nil {
		var verrs validator.ValidationErrors
		if errors.As(err, &verrs) {
			details := make([]apiresponse.FieldError, 0, len(verrs))
			for _, fe := range verrs {
				details = append(details, apiresponse.FieldError{
					Field:   fe.Field(),
					Message: humanizeValidationError(fe),
				})
			}
			_ = apiresponse.Validation(c, details...)
			return false
		}
		_ = apiresponse.Validation(c, apiresponse.FieldError{Field: "body", Message: "Request body is missing or malformed JSON"})
		return false
	}
	return true
}

func humanizeValidationError(fe validator.FieldError) string {
	field := fe.Field()
	switch fe.Tag() {
	case "required":
		return fmt.Sprintf("%s is required", field)
	case "email":
		return "Must be a valid email address"
	case "min":
		return fmt.Sprintf("%s must be at least %s characters", field, fe.Param())
	case "max":
		return fmt.Sprintf("%s must be at most %s characters", field, fe.Param())
	case "len":
		return fmt.Sprintf("%s must be exactly %s characters", field, fe.Param())
	case "numeric":
		return fmt.Sprintf("%s must be 6 digits", field)
	case "url":
		return "Must be a valid URL"
	case "oneof":
		return fmt.Sprintf("%s must be one of: %s", field, fe.Param())
	default:
		return fmt.Sprintf("%s is invalid", field)
	}
}
