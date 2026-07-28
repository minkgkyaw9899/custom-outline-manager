import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { apiClient } from "@/lib/api"
import { fieldErrorsFrom } from "@/lib/form-errors"
import { MIN_PLAN_GB } from "@/lib/format"
import type { Server } from "@/lib/types"

/** Static USD→MMK rate, also used by the Revenue page. */
export const MMK_PER_USD = 4500

export function AddServerDialog({ children }: Readonly<{ children: React.ReactNode }>) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [apiUrl, setApiUrl] = useState("")
  const [costUsd, setCostUsd] = useState("6")
  const [maxKeys, setMaxKeys] = useState("")
  const [defaultLimitGb, setDefaultLimitGb] = useState(String(MIN_PLAN_GB))
  const [defaultPriceMmk, setDefaultPriceMmk] = useState("")
  // Indexed by field name, so a miss is genuinely undefined.
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const queryClient = useQueryClient()

  const createServer = useMutation({
    mutationFn: () =>
      apiClient.post<Server>("servers", {
        name: name.trim(),
        apiUrl: apiUrl.trim(),
        costUsdPerMonth: costUsd === "" ? null : Number(costUsd),
        // Blank means "no ceiling" and "no default" respectively, which is not
        // the same as zero — so an empty field has to go over as null.
        maxKeys: maxKeys.trim() === "" ? null : Number(maxKeys),
        defaultLimitGb:
          defaultLimitGb.trim() === "" ? null : Number(defaultLimitGb),
        defaultPriceMmk:
          defaultPriceMmk.trim() === "" ? null : Number(defaultPriceMmk),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      setName("")
      setApiUrl("")
      setCostUsd("6")
      setMaxKeys("")
      setDefaultLimitGb(String(MIN_PLAN_GB))
      setDefaultPriceMmk("")
      setErrors({})
      setOpen(false)
    },
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  const parsedCost = Number(costUsd)
  const mmk = Number.isFinite(parsedCost) ? parsedCost * MMK_PER_USD : 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createServer.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading">Add Outline server</DialogTitle>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="server-name">Server name</FieldLabel>
              <Input
                id="server-name"
                placeholder="Server Name"
                autoComplete="off"
                value={name}
                aria-invalid={!!errors.name || undefined}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && <FieldDescription>{errors.name}</FieldDescription>}
            </Field>

            <Field data-invalid={!!errors.apiUrl || undefined}>
              <FieldLabel htmlFor="server-api-url">Outline management key</FieldLabel>
              <Textarea
                id="server-api-url"
                className="font-mono text-xs"
                placeholder={'Enter Management Key'}
                autoComplete="off"
                spellCheck={false}
                value={apiUrl}
                aria-invalid={!!errors.apiUrl || undefined}
                onChange={(e) => setApiUrl(e.target.value)}
              />
              {errors.apiUrl ?? <FieldDescription>
                {errors.apiUrl}
              </FieldDescription>}
            </Field>

            <Field data-invalid={!!errors.costUsdPerMonth || undefined}>
              <FieldLabel htmlFor="server-cost">Instance cost (USD / month)</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>$</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="server-cost"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="decimal"
                  value={costUsd}
                  aria-invalid={!!errors.costUsdPerMonth || undefined}
                  onChange={(e) => setCostUsd(e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText className="font-mono tabular-nums">
                    = {mmk.toLocaleString("en-US")} MMK
                  </InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {errors.costUsdPerMonth ??
                  `Converted at the static rate of ${MMK_PER_USD.toLocaleString("en-US")} MMK per $1 — used on the Revenue page.`}
              </FieldDescription>
            </Field>

            <Field data-invalid={!!errors.maxKeys || undefined}>
              <FieldLabel htmlFor="server-max-keys">
                Total key limit (optional)
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="server-max-keys"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="No limit"
                  value={maxKeys}
                  aria-invalid={!!errors.maxKeys || undefined}
                  onChange={(e) => setMaxKeys(e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>keys</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {errors.maxKeys ??
                 ""}
              </FieldDescription>
            </Field>

            <Field data-invalid={!!errors.defaultLimitGb || undefined}>
              <FieldLabel htmlFor="server-default-limit">
                Default data limit
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="server-default-limit"
                  type="number"
                  min={1}
                  step="any"
                  inputMode="decimal"
                  placeholder="No default"
                  value={defaultLimitGb}
                  aria-invalid={!!errors.defaultLimitGb || undefined}
                  onChange={(e) => setDefaultLimitGb(e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>GB</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {errors.defaultLimitGb ??
                  ""}
              </FieldDescription>
            </Field>

            <Field data-invalid={!!errors.defaultPriceMmk || undefined}>
              <FieldLabel htmlFor="server-default-price">
                Price per key
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="server-default-price"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="Not set"
                  value={defaultPriceMmk}
                  aria-invalid={!!errors.defaultPriceMmk || undefined}
                  onChange={(e) => setDefaultPriceMmk(e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>MMK / month</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                {errors.defaultPriceMmk ??
                  "What a new key on this server sells for. Individual keys can be priced differently or marked free later."}
              </FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={createServer.isPending}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={createServer.isPending}>
              {createServer.isPending && <Spinner data-icon="inline-start" />}
              Verify &amp; add server
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
