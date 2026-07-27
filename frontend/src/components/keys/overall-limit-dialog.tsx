import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { apiClient } from "@/lib/api"
import { fieldErrorsFrom } from "@/lib/form-errors"
import { BYTES_PER_GB, MIN_PLAN_GB } from "@/lib/format"
import type { Key } from "@/lib/types"

/**
 * Sets the quota every new key on this server starts on, and optionally brings
 * the server's existing unlimited keys onto the same figure in one go.
 *
 * Keys that already carry a limit are deliberately never touched: an
 * individually negotiated allowance has to survive a change to the server-wide
 * default, or this control becomes a way to quietly overwrite them.
 */
export function OverallLimitDialog({
  serverId,
  defaultLimitBytes,
  keys,
  open,
  onOpenChange,
}: Readonly<{
  serverId: string
  defaultLimitBytes: number | null
  keys: Key[]
  open: boolean
  onOpenChange: (open: boolean) => void
}>) {
  const [limitGb, setLimitGb] = useState(String(MIN_PLAN_GB))
  const [applyToUnlimited, setApplyToUnlimited] = useState(true)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const queryClient = useQueryClient()

  useEffect(() => {
    if (open) {
      setLimitGb(
        defaultLimitBytes === null
          ? String(MIN_PLAN_GB)
          : String(Math.round((defaultLimitBytes / BYTES_PER_GB) * 10) / 10),
      )
      setApplyToUnlimited(true)
      setErrors({})
    }
  }, [open, defaultLimitBytes])

  const unlimitedCount = keys.filter((k) => k.customLimitBytes === null).length
  const gb = Number(limitGb) || 0

  const save = useMutation({
    mutationFn: (clear: boolean) =>
      apiClient.patch(`servers/${serverId}/default-limit`, {
        ...(clear
          ? { clear_default: true }
          : { limit_gb: gb, apply_to_unlimited: applyToUnlimited }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      queryClient.invalidateQueries({ queryKey: ["users"] })
      onOpenChange(false)
    },
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(false)
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading">Overall data limit</DialogTitle>
            <DialogDescription>
              The quota new keys on this server start on.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={!!errors.limit_gb || undefined}>
              <FieldLabel htmlFor="overall-limit">Data limit</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="overall-limit"
                  type="number"
                  min={1}
                  step="any"
                  inputMode="decimal"
                  value={limitGb}
                  aria-invalid={gb <= 0 || !!errors.limit_gb || undefined}
                  onChange={(e) => setLimitGb(e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>GB</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {errors.limit_gb ??
                  (defaultLimitBytes === null
                    ? "This server has no default yet, so new keys fall back to the plan floor."
                    : "Replaces the current default for keys created from here on.")}
              </FieldDescription>
            </Field>

            <Field orientation="horizontal">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="overall-apply">
                  Apply to unlimited keys
                </FieldLabel>
                <FieldDescription>
                  {unlimitedCount === 0
                    ? "Every key here already has a limit, so nothing else changes."
                    : `Also puts the ${unlimitedCount} key${unlimitedCount === 1 ? "" : "s"} with no limit onto this figure. Keys that already have one are left alone.`}
                </FieldDescription>
              </div>
              <Switch
                id="overall-apply"
                checked={applyToUnlimited}
                disabled={unlimitedCount === 0}
                onCheckedChange={setApplyToUnlimited}
              />
            </Field>
          </FieldGroup>

          <DialogFooter className="sm:justify-between">
            {defaultLimitBytes !== null ? (
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                disabled={save.isPending}
                onClick={() => save.mutate(true)}
              >
                Clear default
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <DialogClose
                render={
                  <Button type="button" variant="outline" disabled={save.isPending}>
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" disabled={save.isPending || gb <= 0}>
                {save.isPending && <Spinner data-icon="inline-start" />}
                Save limit
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
