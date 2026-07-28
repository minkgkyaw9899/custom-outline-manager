import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { MMK_PER_USD } from "@/components/servers/add-server-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
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
import { isMockId, mockUpdateServerConfig } from "@/lib/mock-server-detail"
import type { ServerDetail } from "@/lib/types"

/** A number field's value as the API wants it: blank means "no ceiling". */
function toNullableNumber(raw: string): number | null {
  return raw.trim() === "" ? null : Number(raw)
}

/**
 * Everything about a server the admin can change after adding it: its display
 * name, its monthly cost, how many keys it may hold, and the domain or IP
 * baked into every key's static ss:// link.
 *
 * Only the hostname leaves this process — it is pushed to Outline, which
 * rewrites every existing key's link. The rest is local metadata. Dynamic
 * ssconf:// links always use the deployment-wide public base URL, so there is
 * no per-server override for them.
 *
 * A server whose keys carry no host yet (a fresh server, or one Outline has
 * never had a hostname set on) reports an empty accessKeyHostname. Rather than
 * open on a blank field, the dialog falls back to the server's own API-URL
 * domain and treats that as a pending change, so a single Save binds the
 * domain to every access key instead of making the admin retype what the
 * server already knows about itself.
 */
export function EditServerDialog({
  serverId,
  detail,
  open,
  onOpenChange,
}: Readonly<{
  serverId: string
  detail: ServerDetail | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}>) {
  const [name, setName] = useState("")
  const [costUsd, setCostUsd] = useState("")
  const [maxKeys, setMaxKeys] = useState("")
  const [defaultPriceMmk, setDefaultPriceMmk] = useState("")
  const [hostname, setHostname] = useState("")
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const queryClient = useQueryClient()
  const isMock = isMockId(serverId)

  useEffect(() => {
    if (open && detail) {
      setName(detail.server.name)
      setCostUsd(
        detail.server.costUsdPerMonth === null
          ? ""
          : String(detail.server.costUsdPerMonth),
      )
      setMaxKeys(
        detail.server.maxKeys === null ? "" : String(detail.server.maxKeys),
      )
      setDefaultPriceMmk(
        detail.server.defaultPriceMmk === null
          ? ""
          : String(detail.server.defaultPriceMmk),
      )
      setHostname(detail.accessKeyHostname || detail.hostname)
      setErrors({})
    }
  }, [open, detail])

  const trimmedName = name.trim()
  const trimmedHostname = hostname.trim()

  const currentCost =
    detail?.server.costUsdPerMonth === null || detail === undefined
      ? ""
      : String(detail.server.costUsdPerMonth)
  const currentMaxKeys =
    detail?.server.maxKeys === null || detail === undefined
      ? ""
      : String(detail.server.maxKeys)
  const currentDefaultPriceMmk =
    detail?.server.defaultPriceMmk === null || detail === undefined
      ? ""
      : String(detail.server.defaultPriceMmk)

  const nameChanged = trimmedName !== (detail?.server.name ?? "")
  const costChanged = costUsd.trim() !== currentCost
  const maxKeysChanged = maxKeys.trim() !== currentMaxKeys
  const defaultPriceMmkChanged = defaultPriceMmk.trim() !== currentDefaultPriceMmk
  // Compared against what Outline actually stamps today, never against the
  // API-URL fallback — that is what makes an auto-bound domain count as a
  // change and get pushed on Save.
  const hostnameChanged = trimmedHostname !== (detail?.accessKeyHostname ?? "")
  // No key carries a host yet, so the field above is showing the auto-bound
  // API-URL domain rather than a value read back off the server.
  const hostnameUnbound =
    detail !== undefined && detail.accessKeyHostname === "" && detail.hostname !== ""
  const nothingToDo =
    !nameChanged && !costChanged && !maxKeysChanged &&
    !defaultPriceMmkChanged && !hostnameChanged

  // "Absent" and "explicitly none" can't both be nil on the wire, so removing a
  // ceiling (or a default price) is its own flag rather than a null value.
  const clearingMaxKeys = maxKeysChanged && maxKeys.trim() === ""
  const parsedMaxKeys = toNullableNumber(maxKeys)
  const clearingDefaultPriceMmk =
    defaultPriceMmkChanged && defaultPriceMmk.trim() === ""
  const parsedDefaultPriceMmk = toNullableNumber(defaultPriceMmk)

  const keyCount = detail?.keys.length ?? 0
  const belowKeyCount = parsedMaxKeys !== null && parsedMaxKeys < keyCount

  const save = useMutation({
    mutationFn: async () => {
      if (isMock) {
        return mockUpdateServerConfig(
          hostnameChanged ? trimmedHostname : undefined,
        )
      }
      return apiClient.patch(`servers/${serverId}/config`, {
        ...(nameChanged ? { name: trimmedName } : {}),
        ...(costChanged ? { costUsdPerMonth: toNullableNumber(costUsd) } : {}),
        ...(maxKeysChanged && !clearingMaxKeys ? { maxKeys: parsedMaxKeys } : {}),
        ...(clearingMaxKeys ? { clearMaxKeys: true } : {}),
        ...(defaultPriceMmkChanged && !clearingDefaultPriceMmk
          ? { defaultPriceMmk: parsedDefaultPriceMmk }
          : {}),
        ...(clearingDefaultPriceMmk ? { clearDefaultPriceMmk: true } : {}),
        ...(hostnameChanged ? { hostnameForAccessKeys: trimmedHostname } : {}),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      onOpenChange(false)
    },
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  const parsedCost = Number(costUsd)
  const mmk = Number.isFinite(parsedCost) ? parsedCost * MMK_PER_USD : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading">
              Edit server configuration
            </DialogTitle>
          </DialogHeader>

          <FieldGroup className="py-4">
            <FieldSet>
              <Field data-invalid={!!errors.name || undefined}>
                <FieldLabel htmlFor="edit-server-name">Server name</FieldLabel>
                <Input
                  id="edit-server-name"
                  autoComplete="off"
                  placeholder="Update Server Name"
                  value={name}
                  aria-invalid={!!errors.name || undefined}
                  onChange={(e) => setName(e.target.value)}
                />
                <FieldDescription>
                  {errors.name ??
                    ""}
                </FieldDescription>
              </Field>

              <Field data-invalid={!!errors.costUsdPerMonth || undefined}>
                <FieldLabel htmlFor="edit-server-cost">
                  Instance cost (USD / month)
                </FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>$</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="edit-server-cost"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="decimal"
                    placeholder="Not recorded"
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

              <Field
                data-invalid={!!errors.maxKeys || belowKeyCount || undefined}
              >
                <FieldLabel htmlFor="edit-server-max-keys">
                  Total key limit
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="edit-server-max-keys"
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    placeholder="No limit"
                    value={maxKeys}
                    aria-invalid={!!errors.maxKeys || belowKeyCount || undefined}
                    onChange={(e) => setMaxKeys(e.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>keys</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  {errors.maxKeys ??
                    (belowKeyCount
                      ? `This server already has ${keyCount} key${keyCount === 1 ? "" : "s"} — set the limit to ${keyCount} or higher, or delete keys first.`
                      : `Currently holding ${keyCount} key${keyCount === 1 ? "" : "s"}. Leave blank for no ceiling; existing keys are never deleted to satisfy it.`)}
                </FieldDescription>
              </Field>

              <Field data-invalid={!!errors.defaultPriceMmk || undefined}>
                <FieldLabel htmlFor="edit-server-default-price">
                  Price per key
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="edit-server-default-price"
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
                    "What a new key on this server sells for. Leave blank to leave new keys unpriced; existing keys keep whatever price they already have."}
                </FieldDescription>
              </Field>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Static access link</FieldLegend>
              <Field data-invalid={!!errors.hostnameForAccessKeys || undefined}>
                <FieldLabel htmlFor="edit-server-hostname">
                  Hostname for access keys
                </FieldLabel>
                <Input
                  id="edit-server-hostname"
                  autoComplete="off"
                  placeholder="vpn.example.com or 49.12.88.4"
                  value={hostname}
                  aria-invalid={!!errors.hostnameForAccessKeys || undefined}
                  onChange={(e) => setHostname(e.target.value)}
                />
                <FieldDescription>
                  {errors.hostnameForAccessKeys ??
                    (hostnameUnbound
                      ? `No access key carries a host yet — prefilled with this server's own domain (${detail.hostname}). Save to bind it to every access key.`
                      : "")}
                </FieldDescription>
              </Field>
            </FieldSet>
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
                save.isPending || nothingToDo || !trimmedName || belowKeyCount
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
