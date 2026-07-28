import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CalendarIcon } from "lucide-react"

import { keyDisplayName } from "@/components/keys/key-connection-status"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { apiClient } from "@/lib/api"
import { fieldErrorsFrom } from "@/lib/form-errors"
import {
  BYTES_PER_GB,
  formatBytesCompact,
  formatDateOnly,
  MIN_PLAN_DAYS,
  MIN_PLAN_GB,
} from "@/lib/format"
import {
  isMockId,
  mockExtendKey,
  mockRenameKey,
  mockSetKeyPlan,
  mockSetKeyPrice,
} from "@/lib/mock-server-detail"
import type { Key } from "@/lib/types"

/**
 * Two ways to change a key's plan, because they answer different questions.
 *
 * "extend" sells another period: the allowance is added on top of what the
 * holder has already used and the expiry moves on from wherever it is, which
 * is what renewing a paying customer means. Its minimums are the plan floor.
 *
 * "set" writes the figures directly. It exists for keys adopted from a server
 * that predates this dashboard, and for tidying up after a renewal — an
 * extension leaves a limit like "206.9 GB" (200 plus usage), and an admin who
 * wants it to read "200 GB" needs to say so outright. No minimums apply here:
 * it is a correction, not a sale.
 */
type PlanMode = "keep" | "extend" | "set"

const MODES: { value: PlanMode; label: string }[] = [
  { value: "keep", label: "Leave plan" },
  { value: "extend", label: "Extend" },
  { value: "set", label: "Set exact" },
]

/**
 * The calendar works in whole days, so a stored instant is read as the day it
 * falls on in the viewer's own timezone — the day the key list already shows.
 */
function toCalendarDate(iso: string | null): Date {
  return iso ? new Date(iso) : new Date()
}

/** YYYY-MM-DD for the picked day, again in the viewer's own timezone. */
function toDateParam(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function EditKeyDialog({
  keyItem,
  open,
  onOpenChange,
}: Readonly<{
  keyItem: Key | null
  open: boolean
  onOpenChange: (open: boolean) => void
}>) {
  const [name, setName] = useState("")
  const [mode, setMode] = useState<PlanMode>("keep")
  const [addGb, setAddGb] = useState(String(MIN_PLAN_GB))
  const [addDays, setAddDays] = useState(String(MIN_PLAN_DAYS))
  const [limitGb, setLimitGb] = useState(String(MIN_PLAN_GB))
  const [priceMmk, setPriceMmk] = useState("")
  const [endDate, setEndDate] = useState(() => toCalendarDate(null))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  /**
   * The year dropdown needs bounds spelled out: left alone, react-day-picker
   * ends the range at the end of the current year, which would put next year's
   * expiry out of reach. The year back is for correcting a key that has lapsed.
   */
  const monthBounds = useMemo(() => {
    const year = new Date().getFullYear()
    return { startMonth: new Date(year - 1, 0), endMonth: new Date(year + 5, 11) }
  }, [])

  const queryClient = useQueryClient()

  // Reopening on another key must not carry the previous key's edits over.
  useEffect(() => {
    if (open && keyItem) {
      setName(keyDisplayName(keyItem))
      // An expired or exhausted key is only in this dialog to be renewed, so
      // it opens on the extension rather than on "leave as is".
      setMode(
        keyItem.status === "expired" || keyItem.status === "limit_exceeded"
          ? "extend"
          : "keep",
      )
      setAddGb(String(MIN_PLAN_GB))
      setAddDays(String(MIN_PLAN_DAYS))
      setLimitGb(
        keyItem.customLimitBytes === null
          ? String(MIN_PLAN_GB)
          : // Round to a tenth: an inherited limit is rarely a whole number and
            // a full-precision default would be unreadable in the field.
            String(Math.round((keyItem.customLimitBytes / BYTES_PER_GB) * 10) / 10),
      )
      setEndDate(toCalendarDate(keyItem.endDate))
      setPriceMmk(keyItem.priceMmk === null ? "" : String(keyItem.priceMmk))
      setPickerOpen(false)
      setErrors({})
    }
  }, [open, keyItem])

  const gb = Number(addGb) || 0
  const days = Number(addDays) || 0
  const totalGb = Number(limitGb) || 0
  const trimmedName = name.trim()
  const nameChanged = !!keyItem && trimmedName !== keyDisplayName(keyItem)

  const currentPriceMmk =
    keyItem?.priceMmk === null || keyItem === null ? "" : String(keyItem.priceMmk)
  const priceMmkChanged = priceMmk.trim() !== currentPriceMmk
  // "Absent" and "explicitly none" can't both be nil on the wire — clearing
  // the field means "go back to following the server's default price",
  // which is its own flag rather than a null price_mmk (mirroring the
  // server's own default-price/max-keys clearing).
  const clearingPriceMmk = priceMmkChanged && priceMmk.trim() === ""
  const parsedPriceMmk = priceMmk.trim() === "" ? null : Number(priceMmk)
  const invalidPrice =
    priceMmk.trim() !== "" && (!Number.isFinite(parsedPriceMmk) || parsedPriceMmk! < 0)

  const belowFloor = mode === "extend" && (gb < MIN_PLAN_GB || days < MIN_PLAN_DAYS)
  // No date check: the picker always holds a day, it can only be pointed at
  // another one, so the only way "set" goes wrong is the limit.
  const invalidTotal = mode === "set" && totalGb <= 0
  const nothingToDo = !nameChanged && !priceMmkChanged && mode === "keep"

  const save = useMutation({
    mutationFn: async () => {
      if (!keyItem) throw new Error("No key selected")
      const mock = isMockId(keyItem.id)

      // Price is independent of the plan mode, so every branch below folds
      // it into whatever PATCH it's already sending (or sends its own
      // price-only PATCH if nothing else changed).
      const priceFields = clearingPriceMmk
        ? { clear_price_mmk: true }
        : priceMmkChanged
          ? { price_mmk: parsedPriceMmk }
          : {}

      if (mode === "set") {
        const day = toDateParam(endDate)
        // One PATCH carries the name and price too: the endpoint takes
        // absolute values for every field, so there is no reason to make it
        // more than one round trip.
        await (mock
          ? Promise.all([
              mockSetKeyPlan(keyItem.id, totalGb, day, trimmedName),
              priceMmkChanged
                ? mockSetKeyPrice(keyItem.id, parsedPriceMmk)
                : null,
            ])
          : apiClient.patch(`keys/${keyItem.id}`, {
              ...(nameChanged ? { name: trimmedName } : {}),
              limit_gb: totalGb,
              // End of the chosen day in the admin's own timezone, sent as an
              // instant. Sending the bare date would have the server take the
              // end of that day in UTC, which reads back here as the *next*
              // day and creeps forward every time the key is edited.
              end_date: new Date(`${day}T23:59:59`).toISOString(),
              ...priceFields,
            }))
        return
      }

      if (nameChanged || priceMmkChanged) {
        await (mock
          ? Promise.all([
              nameChanged ? mockRenameKey(keyItem.id, trimmedName) : null,
              priceMmkChanged
                ? mockSetKeyPrice(keyItem.id, parsedPriceMmk)
                : null,
            ])
          : apiClient.patch(`keys/${keyItem.id}`, {
              ...(nameChanged ? { name: trimmedName } : {}),
              ...priceFields,
            }))
      }
      if (mode === "extend") {
        await (mock
          ? mockExtendKey(keyItem.id, gb, days)
          : apiClient.post(`keys/${keyItem.id}/renew`, { add_gb: gb, add_days: days }))
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      queryClient.invalidateQueries({ queryKey: ["stats"] })
      // The same dialog edits a holder's key from the user detail page, where
      // the plan figures are read from the user query rather than the key one.
      queryClient.invalidateQueries({ queryKey: ["users"] })
      onOpenChange(false)
    },
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  const extendedLimitBytes = keyItem ? keyItem.usedBytes + gb * BYTES_PER_GB : 0
  // Days are added to whichever is later, today or the current end date, which
  // is what the backend's RenewalTarget does.
  const baseDate =
    keyItem?.endDate && new Date(keyItem.endDate) > new Date()
      ? new Date(keyItem.endDate)
      : new Date()
  const extendedEndDate = new Date(
    baseDate.getTime() + days * 86_400_000,
  ).toISOString()

  const totalBytes = totalGb * BYTES_PER_GB
  const overspent = mode === "set" && !!keyItem && keyItem.usedBytes >= totalBytes

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading">
              Edit {keyItem ? keyDisplayName(keyItem) : "key"}
            </DialogTitle>
            <DialogDescription>
              Rename the key, sell it another period, or write its limit and expiry
              directly. Renaming is pushed to the Outline server so it stays in step
              after the next sync.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="edit-key-name">Key name</FieldLabel>
              <Input
                id="edit-key-name"
                autoComplete="off"
                value={name}
                aria-invalid={!!errors.name || undefined}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && <FieldDescription>{errors.name}</FieldDescription>}
            </Field>

            <Field data-invalid={!!errors.price_mmk || invalidPrice || undefined}>
              <FieldLabel htmlFor="edit-key-price">Price</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="edit-key-price"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="Follows the server's default"
                  value={priceMmk}
                  aria-invalid={!!errors.price_mmk || invalidPrice || undefined}
                  onChange={(e) => setPriceMmk(e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>MMK / month</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {errors.price_mmk ??
                  "Enter 0 if this key is free. Leave blank to follow the server's default price."}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Plan</FieldLabel>
              <ToggleGroup
                value={[mode]}
                onValueChange={(v) => {
                  if (v.length) setMode(v[0] as PlanMode)
                }}
              >
                {MODES.map((m) => (
                  <ToggleGroupItem
                    key={m.value}
                    value={m.value}
                    className="rounded-full border px-4 text-sm tracking-normal normal-case aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary"
                  >
                    {m.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>
                {mode === "keep" &&
                  `Currently ${formatBytesCompact(keyItem?.customLimitBytes, { decimals: 1 })} · ${keyItem?.endDate ? `expires ${formatDateOnly(keyItem.endDate)}` : "no expiry"}.`}
                {mode === "extend" &&
                  "Adds an allowance on top of current usage and pushes the expiry out."}
                {mode === "set" &&
                  "Writes the limit and expiry exactly as entered, ignoring current usage."}
              </FieldDescription>
            </Field>

            {mode === "extend" && (
              <>
                <Field data-invalid={!!errors.add_gb || undefined}>
                  <FieldLabel htmlFor="edit-key-gb">Add data</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="edit-key-gb"
                      type="number"
                      min={MIN_PLAN_GB}
                      // "any", not a step: with a step the browser only accepts
                      // multiples counted from `min`, so a plain 250 would fail
                      // native validation and the form would refuse to submit
                      // without saying why.
                      step="any"
                      inputMode="decimal"
                      value={addGb}
                      aria-invalid={gb < MIN_PLAN_GB || undefined}
                      onChange={(e) => setAddGb(e.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>GB</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>
                    {errors.add_gb ??
                      (gb < MIN_PLAN_GB
                        ? `A plan period is at least ${MIN_PLAN_GB} GB.`
                        : `On top of the ${formatBytesCompact(keyItem?.usedBytes, { decimals: 1 })} already used.`)}
                  </FieldDescription>
                </Field>

                <Field data-invalid={!!errors.add_days || undefined}>
                  <FieldLabel htmlFor="edit-key-days">Extend expiry</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="edit-key-days"
                      type="number"
                      min={MIN_PLAN_DAYS}
                      step={1}
                      inputMode="numeric"
                      value={addDays}
                      aria-invalid={days < MIN_PLAN_DAYS || undefined}
                      onChange={(e) => setAddDays(e.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>days</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>
                    {errors.add_days ??
                      (days < MIN_PLAN_DAYS
                        ? `A plan period is at least ${MIN_PLAN_DAYS} days.`
                        : `New limit ${formatBytesCompact(extendedLimitBytes, { decimals: 1 })} · expires ${formatDateOnly(extendedEndDate)}.`)}
                  </FieldDescription>
                </Field>
              </>
            )}

            {mode === "set" && (
              <>
                <Field data-invalid={!!errors.limit_gb || overspent || undefined}>
                  <FieldLabel htmlFor="edit-key-total">Total data limit</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="edit-key-total"
                      type="number"
                      min={1}
                      step="any"
                      inputMode="decimal"
                      value={limitGb}
                      aria-invalid={totalGb <= 0 || overspent || undefined}
                      onChange={(e) => setLimitGb(e.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>GB</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>
                    {errors.limit_gb ??
                      (overspent
                        ? `The holder has already used ${formatBytesCompact(keyItem.usedBytes, { decimals: 1 })}, so this switches the key off straight away.`
                        : `${formatBytesCompact(Math.max(0, totalBytes - (keyItem?.usedBytes ?? 0)), { decimals: 1 })} left after the ${formatBytesCompact(keyItem?.usedBytes, { decimals: 1 })} already used.`)}
                  </FieldDescription>
                </Field>

                <Field data-invalid={!!errors.end_date || undefined}>
                  <FieldLabel htmlFor="edit-key-expiry">Expires on</FieldLabel>
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          id="edit-key-expiry"
                          type="button"
                          variant="ghost"
                          // Dressed as the underlined fields above it: it sits
                          // in the same column of inputs and should read as one
                          // rather than as a button dropped into the form.
                          className="h-10 w-full justify-between border-b-input px-0 text-base font-normal tracking-normal normal-case hover:border-b-ring/60 hover:bg-transparent focus-visible:border-transparent focus-visible:border-b-ring focus-visible:ring-0 aria-expanded:border-b-ring aria-expanded:bg-transparent aria-invalid:border-transparent aria-invalid:border-b-destructive aria-invalid:ring-0 md:text-sm"
                          aria-invalid={!!errors.end_date || undefined}
                        />
                      }
                    >
                      {formatDateOnly(endDate.toISOString())}
                      <CalendarIcon data-icon="inline-end" />
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        mode="single"
                        captionLayout="dropdown"
                        startMonth={monthBounds.startMonth}
                        endMonth={monthBounds.endMonth}
                        defaultMonth={endDate}
                        selected={endDate}
                        // Clicking the selected day again hands back undefined;
                        // a key always has an expiry, so that is a no-op.
                        onSelect={(date) => {
                          if (!date) return
                          setEndDate(date)
                          setPickerOpen(false)
                        }}
                        autoFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FieldDescription>
                    {errors.end_date ?? "The key works through the end of this day."}
                  </FieldDescription>
                </Field>
              </>
            )}
          </FieldGroup>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={save.isPending}>
                  Cancel
                </Button>
              }
            />
            <Button
              type="submit"
              disabled={
                save.isPending ||
                nothingToDo ||
                belowFloor ||
                invalidTotal ||
                invalidPrice ||
                !trimmedName
              }
            >
              {save.isPending && <Spinner data-icon="inline-start" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
