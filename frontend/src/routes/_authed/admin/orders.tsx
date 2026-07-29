import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ShoppingCartIcon, Trash2Icon } from "lucide-react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { apiClient } from "@/lib/api"
import { ordersQueryOptions } from "@/lib/queries"
import type { Order, OrderStatus } from "@/lib/types"

export const Route = createFileRoute("/_authed/admin/orders")({
  component: OrdersPage,
})

function deleteOrderDescription(order: Order | null): string {
  if (!order) return ""
  const consequence =
    order.status === "approved"
      ? "The user and key it created are not affected — delete those separately if needed."
      : "This cannot be undone."
  return `Removes the order record for ${order.customerName} from the history. ${consequence}`
}

function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState<OrderStatus>("pending")
  const { data: orders, isLoading } = useQuery(ordersQueryOptions(statusFilter))
  const queryClient = useQueryClient()

  const [approving, setApproving] = useState<Order | null>(null)
  const [rejecting, setRejecting] = useState<Order | null>(null)
  const [deleting, setDeleting] = useState<Order | null>(null)
  const [adminNote, setAdminNote] = useState("")

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["orders"] })

  const approve = useMutation({
    mutationFn: (order: Order) =>
      apiClient.post<Order>(`orders/${order.id}/approve`, {}),
    onSuccess: () => {
      setApproving(null)
      invalidate()
    },
  })

  const reject = useMutation({
    mutationFn: (order: Order) =>
      apiClient.post<Order>(`orders/${order.id}/reject`, { adminNote }),
    onSuccess: () => {
      setRejecting(null)
      setAdminNote("")
      invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (order: Order) => apiClient.delete(`orders/${order.id}`),
    onSuccess: () => {
      setDeleting(null)
      invalidate()
    },
  })

  let tableContent: React.ReactNode
  if (isLoading) {
    tableContent = <Skeleton className="h-48" />
  } else if (!orders || orders.length === 0) {
    tableContent = (
      <Empty className="rounded-lg border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShoppingCartIcon />
          </EmptyMedia>
          <EmptyTitle>No {statusFilter} orders</EmptyTitle>
          <EmptyDescription>
            Orders submitted from the public order page show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    tableContent = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Server</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <div className="font-medium">{order.customerName}</div>
                <div className="text-xs text-muted-foreground">{order.contact}</div>
                {order.customerNote && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {order.customerNote}
                  </div>
                )}
              </TableCell>
              <TableCell>{order.serverName ?? "—"}</TableCell>
              <TableCell className="font-mono tabular-nums">
                {order.planGb} GB / {order.planDays}d
              </TableCell>
              <TableCell>{order.paymentMethod}</TableCell>
              <TableCell>
                <StatusBadge status={order.status} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  {statusFilter === "pending" ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setRejecting(order)}>
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => setApproving(order)}>
                        Approve
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Delete order from ${order.customerName}`}
                      title="Delete order"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleting(order)}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Dashboard / Orders</p>
          <h1 className="font-heading text-2xl font-semibold">Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Self-serve requests submitted from the public order page. Payment
            is manual — verify it yourself before approving.
          </p>
        </div>
        <ToggleGroup
          value={[statusFilter]}
          onValueChange={(v) => {
            if (v.length) setStatusFilter(v[0] as OrderStatus)
          }}
        >
          <ToggleGroupItem value="pending" className="text-sm normal-case tracking-normal">
            Pending
          </ToggleGroupItem>
          <ToggleGroupItem value="approved" className="text-sm normal-case tracking-normal">
            Approved
          </ToggleGroupItem>
          <ToggleGroupItem value="rejected" className="text-sm normal-case tracking-normal">
            Rejected
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Card>
        <CardContent>{tableContent}</CardContent>
      </Card>

      <ConfirmDialog
        open={!!approving}
        onOpenChange={(open) => !open && setApproving(null)}
        title="Approve this order?"
        description={
          approving
            ? `Creates a user for ${approving.customerName} with a ${approving.planGb} GB / ${approving.planDays}-day key on ${approving.serverName ?? "the requested server"}. Make sure you've verified the ${approving.paymentMethod} payment first.`
            : ""
        }
        confirmLabel="Approve"
        confirmVariant="default"
        isPending={approve.isPending}
        onConfirm={() => approving && approve.mutate(approving)}
      />

      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null)
            setAdminNote("")
          }
        }}
        title="Reject this order?"
        description=""
        confirmLabel="Reject"
        confirmVariant="destructive"
        isPending={reject.isPending}
        onConfirm={() => rejecting && reject.mutate(rejecting)}
      >
        <Field>
          <FieldLabel htmlFor="reject-note">Reason (optional, for your own records)</FieldLabel>
          <Textarea
            id="reject-note"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
          />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this order?"
        description={deleteOrderDescription(deleting)}
        confirmLabel="Delete"
        isPending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  )
}
