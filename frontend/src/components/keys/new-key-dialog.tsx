import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { PlanPresetPicker } from "@/components/keys/plan-preset-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { apiClient } from "@/lib/api"
import { fieldErrorsFrom } from "@/lib/form-errors"
import { MIN_PLAN_DAYS, MIN_PLAN_GB } from "@/lib/format"
import { isMockId, mockCreateKey } from "@/lib/mock-server-detail"
import type { Key } from "@/lib/types"

/**
 * Creates an access key on the server. Every key starts on at least one plan
 * period (200 GB / 30 days) — the backend rejects anything smaller — so the
 * allowance fields are pre-filled with the floor rather than left blank.
 */
export function NewKeyDialog({
  serverId,
  children,
}: Readonly<{ serverId: string; children: React.ReactNode }>) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [limitGb, setLimitGb] = useState(String(MIN_PLAN_GB))
  const [days, setDays] = useState(String(MIN_PLAN_DAYS))
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const queryClient = useQueryClient()

  const gb = Number(limitGb) || 0
  const addDays = Number(days) || 0
  const belowFloor = gb < MIN_PLAN_GB || addDays < MIN_PLAN_DAYS

  const createKey = useMutation({
    mutationFn: () =>
      isMockId(serverId)
        ? mockCreateKey(name.trim(), gb, addDays)
        : apiClient.post<Key>(`servers/${serverId}/keys`, {
            name: name.trim(),
            add_gb: gb,
            add_days: addDays,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["stats"] })
      setName("")
      setLimitGb(String(MIN_PLAN_GB))
      setDays(String(MIN_PLAN_DAYS))
      setErrors({})
      setOpen(false)
    },
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createKey.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading">New access key</DialogTitle>
            <DialogDescription>
              The key is created on the Outline server straight away, on a plan
              of at least {MIN_PLAN_GB} GB for {MIN_PLAN_DAYS} days. When the
              expiry passes the key is switched off until it is extended.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="key-name">Key name</FieldLabel>
              <Input
                id="key-name"
                placeholder="Aung — Monthly 200GB"
                autoComplete="off"
                value={name}
                aria-invalid={!!errors.name || undefined}
                onChange={(e) => setName(e.target.value)}
              />
              <FieldDescription>
                {errors.name ??
                  "Shown in this dashboard and on the holder's device. Whoever gets the link is the only one who can use it, so name it after them."}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Quick pick</FieldLabel>
              <PlanPresetPicker
                onPick={(presetGb, presetDays) => {
                  setLimitGb(String(presetGb))
                  setDays(String(presetDays))
                }}
              />
            </Field>

            <Field data-invalid={!!errors.add_gb || undefined}>
              <FieldLabel htmlFor="key-limit">Data limit</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="key-limit"
                  type="number"
                  min={MIN_PLAN_GB}
                  // See edit-key-dialog: a numeric step would make the browser
                  // reject anything that is not floor + n*step.
                  step="any"
                  inputMode="decimal"
                  value={limitGb}
                  aria-invalid={gb < MIN_PLAN_GB || undefined}
                  onChange={(e) => setLimitGb(e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>GB</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              {(errors.add_gb || gb < MIN_PLAN_GB) && (
                <FieldDescription>
                  {errors.add_gb ??
                    `A key starts at ${MIN_PLAN_GB} GB or more.`}
                </FieldDescription>
              )}
            </Field>

            <Field data-invalid={!!errors.add_days || undefined}>
              <FieldLabel htmlFor="key-days">Valid for</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="key-days"
                  type="number"
                  min={MIN_PLAN_DAYS}
                  step={1}
                  inputMode="numeric"
                  value={days}
                  aria-invalid={addDays < MIN_PLAN_DAYS || undefined}
                  onChange={(e) => setDays(e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>days</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              {(errors.add_days || addDays < MIN_PLAN_DAYS) && (
                <FieldDescription>
                  {errors.add_days ??
                    `A key runs for ${MIN_PLAN_DAYS} days or more.`}
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={createKey.isPending}
                >
                  Cancel
                </Button>
              }
            />
            <Button
              type="submit"
              disabled={createKey.isPending || !name.trim() || belowFloor}
            >
              {createKey.isPending && <Spinner data-icon="inline-start" />}
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
