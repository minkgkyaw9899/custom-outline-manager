package handlers

import (
	"errors"
	"net/url"

	"github.com/gofiber/fiber/v3"

	"outline-manager/internal/apiresponse"
	"outline-manager/internal/models"
	"outline-manager/internal/repository"
)

// listAdmins returns every admin user with isRoot computed for the immutable
// super-admin, so the frontend can render the protected badge without
// hardcoding the root email.
func (a *API) listAdmins(c fiber.Ctx) error {
	admins, err := a.repo.ListAdmins(c.Context())
	if err != nil {
		return apiresponse.Internal(c, "")
	}
	for i := range admins {
		admins[i].IsRoot = a.isRootAdmin(admins[i].Email)
	}
	return apiresponse.Success(c, admins, "")
}

type addAdminRequest struct {
	Email string `json:"email" validate:"required,email"`
}

func (a *API) addAdmin(c fiber.Ctx) error {
	var req addAdminRequest
	if !bindJSON(c, &req) {
		return nil
	}
	email := normalizeEmail(req.Email)

	admin, err := a.repo.CreateAdmin(c.Context(), email)
	if err != nil {
		if errors.Is(err, repository.ErrAlreadyExists) {
			return apiresponse.Validation(c, apiresponse.FieldError{Field: "email", Message: "This email is already an admin"})
		}
		return apiresponse.Internal(c, "")
	}
	admin.IsRoot = a.isRootAdmin(admin.Email)
	return apiresponse.Created(c, admin, "Admin added")
}

// deleteAdmin is the enforcement point for the root-admin protection rule:
// the immutable root admin can never be removed through the API, no matter
// who is asking or what they claim.
func (a *API) deleteAdmin(c fiber.Ctx) error {
	rawEmail := c.Params("email")
	email, err := url.QueryUnescape(rawEmail)
	if err != nil {
		email = rawEmail
	}
	email = normalizeEmail(email)

	if a.isRootAdmin(email) {
		return apiresponse.Forbidden(c, "The root admin cannot be removed")
	}

	if err := a.repo.DeleteAdminByEmail(c.Context(), email); err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.NoContentOK(c, "Admin removed")
}

type setAdminStatusRequest struct {
	Status models.AdminStatus `json:"status" validate:"required,oneof=active suspended"`
}

// setAdminStatus is the other half of root-admin protection: the root admin
// can never be suspended either, since that would functionally lock out the
// one account guaranteed to always have access.
func (a *API) setAdminStatus(c fiber.Ctx) error {
	rawEmail := c.Params("email")
	email, err := url.QueryUnescape(rawEmail)
	if err != nil {
		email = rawEmail
	}
	email = normalizeEmail(email)

	if a.isRootAdmin(email) {
		return apiresponse.Forbidden(c, "The root admin's status cannot be changed")
	}

	var req setAdminStatusRequest
	if !bindJSON(c, &req) {
		return nil
	}

	if err := a.repo.SetAdminStatus(c.Context(), email, req.Status); err != nil {
		return respondRepoErr(c, err)
	}
	return apiresponse.NoContentOK(c, "Admin status updated")
}
