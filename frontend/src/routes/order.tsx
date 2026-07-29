import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCircle2Icon } from "lucide-react"

import { AuthLayout } from "@/components/layout/auth-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { apiClient } from "@/lib/api"
import { fieldErrorsFrom } from "@/lib/form-errors"
import { PLAN_PRESETS } from "@/lib/plan-presets"
import { publicPaymentInfoQueryOptions, publicServersQueryOptions } from "@/lib/queries"
import type { Order } from "@/lib/types"

export const Route = createFileRoute("/order")({
  component: OrderPage,
})

function OrderPage() {
  const { data: paymentInfo, isLoading: paymentInfoLoading } = useQuery(
    publicPaymentInfoQueryOptions(),
  )
  const { data: servers, isLoading: serversLoading } = useQuery(publicServersQueryOptions())

  const [customerName, setCustomerName] = useState("")
  const [contact, setContact] = useState("")
  const [serverId, setServerId] = useState("")
  const [planIndex, setPlanIndex] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState("")
  const [customerNote, setCustomerNote] = useState("")
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const submit = useMutation({
    mutationFn: () =>
      apiClient.post<Order>("orders", {
        customerName: customerName.trim(),
        contact: contact.trim(),
        serverId,
        planGb: PLAN_PRESETS[planIndex].gb,
        planDays: PLAN_PRESETS[planIndex].days,
        paymentMethod,
        customerNote: customerNote.trim(),
      }),
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  if (submit.isSuccess) {
    return (
      <AuthLayout
        badge="Order"
        heading="Order received."
        description="An admin will confirm your payment and set up your access shortly."
      >
        <Empty className="rounded-lg border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircle2Icon className="text-primary" />
            </EmptyMedia>
            <EmptyTitle>Thanks, {submit.data.customerName}!</EmptyTitle>
            <EmptyDescription>
              Your order for {submit.data.planGb} GB / {submit.data.planDays}{" "}
              days is in — you&apos;ll be contacted at &ldquo;{submit.data.contact}
              &rdquo; once it&apos;s confirmed.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      badge="Order"
      heading="Get connected."
      description="Pick a plan, send payment, and tell us how to reach you — an admin sets up your access as soon as it's confirmed."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit.mutate()
        }}
        className="flex flex-col gap-4"
      >
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Payment</CardTitle>
            <CardDescription>
              Manual transfer only — no card or automatic checkout. Send
              payment first, then submit this form.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {paymentInfoLoading ? (
              <Skeleton className="h-16" />
            ) : (
              <>
                <div className="font-mono text-lg font-semibold tracking-wide">
                  {paymentInfo?.paymentPhone}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {paymentInfo?.paymentWallets.map((wallet) => (
                    <Badge key={wallet} variant="secondary">
                      {wallet}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Your details</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={!!errors.customerName || undefined}>
                <FieldLabel htmlFor="order-name">Name</FieldLabel>
                <Input
                  id="order-name"
                  autoComplete="name"
                  value={customerName}
                  aria-invalid={!!errors.customerName || undefined}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
                {errors.customerName && (
                  <FieldDescription>{errors.customerName}</FieldDescription>
                )}
              </Field>

              <Field data-invalid={!!errors.contact || undefined}>
                <FieldLabel htmlFor="order-contact">
                  Phone or Telegram
                </FieldLabel>
                <Input
                  id="order-contact"
                  placeholder="09xxxxxxxxx or @username"
                  value={contact}
                  aria-invalid={!!errors.contact || undefined}
                  onChange={(e) => setContact(e.target.value)}
                />
                {errors.contact && <FieldDescription>{errors.contact}</FieldDescription>}
              </Field>

              <Field data-invalid={!!errors.serverId || undefined}>
                <FieldLabel htmlFor="order-server">Server</FieldLabel>
                {serversLoading ? (
                  <Skeleton className="h-9" />
                ) : (
                  <Select
                    items={Object.fromEntries((servers ?? []).map((s) => [s.id, s.name]))}
                    value={serverId}
                    onValueChange={(v) => setServerId(v as string)}
                  >
                    <SelectTrigger id="order-server" aria-invalid={!!errors.serverId || undefined}>
                      <SelectValue placeholder="Choose a server" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(servers ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
                {errors.serverId && <FieldDescription>{errors.serverId}</FieldDescription>}
              </Field>

              <Field>
                <FieldLabel>Plan</FieldLabel>
                <ToggleGroup
                  value={[String(planIndex)]}
                  onValueChange={(v) => {
                    if (v.length) setPlanIndex(Number(v[0]))
                  }}
                  className="flex-wrap justify-start"
                >
                  {PLAN_PRESETS.map((preset, i) => (
                    <ToggleGroupItem
                      key={preset.label}
                      value={String(i)}
                      className="text-sm normal-case tracking-normal"
                    >
                      {preset.label} — {preset.gb} GB / {preset.days}d
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>

              <Field data-invalid={!!errors.paymentMethod || undefined}>
                <FieldLabel htmlFor="order-payment-method">
                  Which wallet did you pay from?
                </FieldLabel>
                {paymentInfoLoading ? (
                  <Skeleton className="h-9" />
                ) : (
                  <Select
                    items={Object.fromEntries(
                      (paymentInfo?.paymentWallets ?? []).map((w) => [w, w]),
                    )}
                    value={paymentMethod}
                    onValueChange={(v) => setPaymentMethod(v as string)}
                  >
                    <SelectTrigger
                      id="order-payment-method"
                      aria-invalid={!!errors.paymentMethod || undefined}
                    >
                      <SelectValue placeholder="Choose a wallet" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(paymentInfo?.paymentWallets ?? []).map((w) => (
                          <SelectItem key={w} value={w}>
                            {w}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
                {errors.paymentMethod && (
                  <FieldDescription>{errors.paymentMethod}</FieldDescription>
                )}
              </Field>

              <Field data-invalid={!!errors.customerNote || undefined}>
                <FieldLabel htmlFor="order-note">
                  Note (optional)
                </FieldLabel>
                <Textarea
                  id="order-note"
                  placeholder="Transaction reference, or anything else worth knowing"
                  value={customerNote}
                  onChange={(e) => setCustomerNote(e.target.value)}
                />
                {errors.customerNote && (
                  <FieldDescription>{errors.customerNote}</FieldDescription>
                )}
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Button
          type="submit"
          size="lg"
          disabled={
            submit.isPending || !customerName.trim() || !contact.trim() || !serverId || !paymentMethod
          }
        >
          {submit.isPending && <Spinner data-icon="inline-start" />}
          Submit order
        </Button>
      </form>
    </AuthLayout>
  )
}
