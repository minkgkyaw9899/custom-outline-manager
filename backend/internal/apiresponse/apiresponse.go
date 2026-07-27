// Package apiresponse is the single place that shapes every HTTP response the
// API sends. Every handler funnels through Success or Error here so the
// frontend can rely on one envelope for the entire surface:
//
//	{"success": true,  "data": ..., "message": "...", "timestamp": "..."}
//	{"success": false, "error": {"code", "message", "details"}, "timestamp": "..."}
//
// Every helper returns the error from Ctx.JSON so handlers can just
// `return apiresponse.Success(c, data, msg)`.
package apiresponse

import (
	"time"

	"github.com/gofiber/fiber/v3"
)

type ErrorCode string

const (
	CodeValidationError   ErrorCode = "VALIDATION_ERROR"
	CodeUnauthorized      ErrorCode = "UNAUTHORIZED"
	CodeForbidden         ErrorCode = "FORBIDDEN"
	CodeNotFound          ErrorCode = "NOT_FOUND"
	CodeConflict          ErrorCode = "CONFLICT"
	CodeBadGateway        ErrorCode = "BAD_GATEWAY"
	CodeInternalServerErr ErrorCode = "INTERNAL_SERVER_ERROR"
)

// FieldError is one entry in an error envelope's details array, binding a
// validation failure to the specific form field that caused it.
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

type successEnvelope struct {
	Success   bool   `json:"success"`
	Data      any    `json:"data"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

type errorBody struct {
	Code    ErrorCode    `json:"code"`
	Message string       `json:"message"`
	Details []FieldError `json:"details,omitempty"`
}

type errorEnvelope struct {
	Success   bool      `json:"success"`
	Error     errorBody `json:"error"`
	Timestamp string    `json:"timestamp"`
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

// Success writes a 200 envelope. Use Created for 201s.
func Success(c fiber.Ctx, data any, message string) error {
	return c.Status(200).JSON(successEnvelope{Success: true, Data: data, Message: message, Timestamp: now()})
}

// Created writes a 201 success envelope.
func Created(c fiber.Ctx, data any, message string) error {
	return c.Status(201).JSON(successEnvelope{Success: true, Data: data, Message: message, Timestamp: now()})
}

// NoContentOK writes a 200 success envelope with null data, for actions
// (delete, logout) that have nothing to return but still owe the frontend a
// parseable envelope rather than a bare 204.
func NoContentOK(c fiber.Ctx, message string) error {
	return c.Status(200).JSON(successEnvelope{Success: true, Data: nil, Message: message, Timestamp: now()})
}

// Error writes a standardized error envelope.
func Error(c fiber.Ctx, status int, code ErrorCode, message string, details ...FieldError) error {
	return c.Status(status).JSON(errorEnvelope{
		Success:   false,
		Error:     errorBody{Code: code, Message: message, Details: details},
		Timestamp: now(),
	})
}

func Validation(c fiber.Ctx, details ...FieldError) error {
	return Error(c, 422, CodeValidationError, "One or more fields are invalid", details...)
}

func BadRequest(c fiber.Ctx, message string) error {
	return Error(c, 400, CodeValidationError, message)
}

func Unauthorized(c fiber.Ctx, message string) error {
	if message == "" {
		message = "Authentication required"
	}
	return Error(c, 401, CodeUnauthorized, message)
}

func Forbidden(c fiber.Ctx, message string) error {
	if message == "" {
		message = "You do not have permission to perform this action"
	}
	return Error(c, 403, CodeForbidden, message)
}

func NotFound(c fiber.Ctx, message string) error {
	if message == "" {
		message = "Resource not found"
	}
	return Error(c, 404, CodeNotFound, message)
}

func Conflict(c fiber.Ctx, message string) error {
	return Error(c, 409, CodeConflict, message)
}

func BadGateway(c fiber.Ctx, message string) error {
	return Error(c, 502, CodeBadGateway, message)
}

func Internal(c fiber.Ctx, message string) error {
	if message == "" {
		message = "Something went wrong. Please try again."
	}
	return Error(c, 500, CodeInternalServerErr, message)
}
