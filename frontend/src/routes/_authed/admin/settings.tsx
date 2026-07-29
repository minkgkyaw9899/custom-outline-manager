import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { apiClient } from "@/lib/api"
import { fieldErrorsFrom } from "@/lib/form-errors"
import { settingsQueryOptions } from "@/lib/queries"
import type { AppSettings } from "@/lib/types"

export const Route = createFileRoute("/_authed/admin/settings")({
  component: SettingsPage,
})

function SettingsPage() {
  const { data: settings, isLoading } = useQuery(settingsQueryOptions())
  const queryClient = useQueryClient()

  const [mmkPerUsd, setMmkPerUsd] = useState("")
  const [paymentPhone, setPaymentPhone] = useState("")
  const [wallets, setWallets] = useState<string[]>([])
  const [newWallet, setNewWallet] = useState("")
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  // Settings arrive async, but the form is plain local state (same pattern as
  // the add/edit server dialogs) rather than a controlled-by-query input, so
  // seed it once the fetch resolves.
  useEffect(() => {
    if (!settings) return
    setMmkPerUsd(String(settings.mmkPerUsd))
    setPaymentPhone(settings.paymentPhone)
    setWallets(settings.paymentWallets)
  }, [settings])

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch<AppSettings>("settings", {
        mmkPerUsd: Number(mmkPerUsd),
        paymentPhone: paymentPhone.trim(),
        paymentWallets: wallets,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(settingsQueryOptions().queryKey, updated)
      setErrors({})
    },
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  const addWallet = () => {
    const trimmed = newWallet.trim()
    if (trimmed && !wallets.includes(trimmed)) {
      setWallets([...wallets, trimmed])
    }
    setNewWallet("")
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">Dashboard / Settings</p>
        <h1 className="font-heading text-2xl font-semibold">Settings</h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
        className="flex flex-col gap-6"
      >
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">
              Exchange rate
            </CardTitle>
            <CardDescription>
              Converts a server's USD hosting cost into MMK for the Revenue and
              Overview pages' profit math. Update this when the real exchange
              rate moves — nothing here drifts automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field data-invalid={!!errors.mmkPerUsd || undefined}>
              <FieldLabel htmlFor="mmk-per-usd">MMK per $1</FieldLabel>
              <InputGroup className="max-w-xs">
                <InputGroupInput
                  id="mmk-per-usd"
                  type="number"
                  min={1}
                  step="any"
                  inputMode="decimal"
                  value={mmkPerUsd}
                  aria-invalid={!!errors.mmkPerUsd || undefined}
                  onChange={(e) => setMmkPerUsd(e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>MMK</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              {errors.mmkPerUsd && (
                <FieldDescription>{errors.mmkPerUsd}</FieldDescription>
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">
              Payment instructions
            </CardTitle>
            <CardDescription>
              Shown to customers on the public order page. Payment is manual — a
              customer transfers directly to this number and an admin confirms
              it; there is no payment-gateway integration.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <Field data-invalid={!!errors.paymentPhone || undefined}>
              <FieldLabel htmlFor="payment-phone">Phone number</FieldLabel>
              <Input
                id="payment-phone"
                autoComplete="off"
                value={paymentPhone}
                aria-invalid={!!errors.paymentPhone || undefined}
                onChange={(e) => setPaymentPhone(e.target.value)}
                className="max-w-xs"
              />
              {errors.paymentPhone && (
                <FieldDescription>{errors.paymentPhone}</FieldDescription>
              )}
            </Field>

            <Field data-invalid={!!errors.paymentWallets || undefined}>
              <FieldLabel htmlFor="payment-wallet-add">
                Accepted wallets
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                {wallets.map((wallet) => (
                  <Badge
                    key={wallet}
                    variant="secondary"
                    className="h-7 gap-1.5 px-2.5"
                  >
                    {wallet}
                    <button
                      type="button"
                      onClick={() =>
                        setWallets(wallets.filter((w) => w !== wallet))
                      }
                      aria-label={`Remove ${wallet}`}
                      className="rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex max-w-xs gap-2">
                <Input
                  id="payment-wallet-add"
                  placeholder="e.g. KBZ Pay"
                  value={newWallet}
                  onChange={(e) => setNewWallet(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addWallet()
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addWallet}>
                  Add
                </Button>
              </div>
              {errors.paymentWallets && (
                <FieldDescription>{errors.paymentWallets}</FieldDescription>
              )}
            </Field>
          </CardContent>
        </Card>

        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner data-icon="inline-start" />}
            Save settings
          </Button>
        </div>
      </form>
    </div>
  )
}
