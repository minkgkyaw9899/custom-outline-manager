package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"outline-manager/internal/models"
)

const orderColumns = `o.id, o.customer_name, o.contact, o.server_id, s.name, o.plan_gb, o.plan_days,
	o.price_mmk, o.payment_method, o.customer_note, o.status, o.admin_note,
	o.resulting_user_id, o.resulting_key_id, o.created_at, o.decided_at`

const orderFrom = `FROM orders o LEFT JOIN servers s ON s.id = o.server_id`

// CreateOrder inserts a pending order from the public order page.
func (r *Repository) CreateOrder(ctx context.Context, o models.Order) (*models.Order, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO orders (customer_name, contact, server_id, plan_gb, plan_days, payment_method, customer_note)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, o.CustomerName, o.Contact, o.ServerID, o.PlanGB, o.PlanDays, o.PaymentMethod, o.CustomerNote)
	var id string
	if err := row.Scan(&id); err != nil {
		return nil, fmt.Errorf("create order: %w", err)
	}
	return r.GetOrder(ctx, id)
}

func (r *Repository) GetOrder(ctx context.Context, id string) (*models.Order, error) {
	if !isUUID(id) {
		return nil, ErrNotFound
	}
	row := r.pool.QueryRow(ctx, `SELECT `+orderColumns+` `+orderFrom+` WHERE o.id = $1`, id)
	return scanOrder(row)
}

// ListOrders returns every order, optionally filtered to one status —
// newest first, so the admin's pending queue shows the latest request on top.
func (r *Repository) ListOrders(ctx context.Context, status models.OrderStatus) ([]models.Order, error) {
	var rows pgx.Rows
	var err error
	if status == "" {
		rows, err = r.pool.Query(ctx, `SELECT `+orderColumns+` `+orderFrom+` ORDER BY o.created_at DESC`)
	} else {
		rows, err = r.pool.Query(ctx, `SELECT `+orderColumns+` `+orderFrom+` WHERE o.status = $1 ORDER BY o.created_at DESC`, status)
	}
	if err != nil {
		return nil, fmt.Errorf("list orders: %w", err)
	}
	defer rows.Close()

	out := make([]models.Order, 0)
	for rows.Next() {
		o, err := scanOrderRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

// DecideOrder records the admin's approve/reject decision. resultingUserID/
// resultingKeyID are only set on approval; both nil for a rejection.
func (r *Repository) DecideOrder(ctx context.Context, id string, status models.OrderStatus, adminNote *string, resultingUserID, resultingKeyID *string) (*models.Order, error) {
	if !isUUID(id) {
		return nil, ErrNotFound
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE orders
		SET status = $2, admin_note = $3, resulting_user_id = $4, resulting_key_id = $5, decided_at = now()
		WHERE id = $1
	`, id, status, adminNote, resultingUserID, resultingKeyID)
	if err != nil {
		return nil, fmt.Errorf("decide order: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetOrder(ctx, id)
}

func scanOrder(row pgx.Row) (*models.Order, error) {
	var o models.Order
	if err := row.Scan(&o.ID, &o.CustomerName, &o.Contact, &o.ServerID, &o.ServerName, &o.PlanGB, &o.PlanDays,
		&o.PriceMmk, &o.PaymentMethod, &o.CustomerNote, &o.Status, &o.AdminNote,
		&o.ResultingUserID, &o.ResultingKeyID, &o.CreatedAt, &o.DecidedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan order: %w", err)
	}
	return &o, nil
}

func scanOrderRow(rows pgx.Rows) (*models.Order, error) {
	var o models.Order
	if err := rows.Scan(&o.ID, &o.CustomerName, &o.Contact, &o.ServerID, &o.ServerName, &o.PlanGB, &o.PlanDays,
		&o.PriceMmk, &o.PaymentMethod, &o.CustomerNote, &o.Status, &o.AdminNote,
		&o.ResultingUserID, &o.ResultingKeyID, &o.CreatedAt, &o.DecidedAt); err != nil {
		return nil, fmt.Errorf("scan order: %w", err)
	}
	return &o, nil
}
