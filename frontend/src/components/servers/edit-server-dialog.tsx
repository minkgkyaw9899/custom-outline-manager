import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RefreshCwIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"
import { apiClient } from "@/lib/api"
import { fieldErrorsFrom } from "@/lib/form-errors"
import { isMockId, mockUpdateServerConfig } from "@/lib/mock-server-detail"
import { useMmkPerUsd } from "@/lib/queries"
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
  const mmkPerUsd = useMmkPerUsd()
  const [name, setName] = useState("")
  const [costUsd, setCostUsd] = useState("")
  const [maxKeys, setMaxKeys] = useState("")
  const [defaultPriceMmk, setDefaultPriceMmk] = useState("")
  const [bandwidthLimitGb, setBandwidthLimitGb] = useState("")
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  // Its own field/state, deliberately separate from the rest of the form —
  // pasting a new management key is a rare, high-stakes action (it repoints
  // this server's whole connection) that shouldn't be bundled with routine
  // name/cost/limit edits or accidentally submitted alongside them.
  const [managementKey, setManagementKey] = useState("")
  const [apiUrlErrors, setApiUrlErrors] = useState<
    Record<string, string | undefined>
  >({})

  const queryClient = useQueryClient()
  const isMock = isMockId(serverId)

  useEffect(() => {
    if (open && detail) {
      setName(detail.server.name)
      setCostUsd(
        detail.server.costUsdPerMonth === null
          ? ""
          : String(detail.server.costUsdPerMonth)
      )
      setMaxKeys(
        detail.server.maxKeys === null ? "" : String(detail.server.maxKeys)
      )
      setDefaultPriceMmk(
        detail.server.defaultPriceMmk === null
          ? ""
          : String(detail.server.defaultPriceMmk)
      )
      setBandwidthLimitGb(
        detail.server.bandwidthLimitBytes === null
          ? ""
          : String(detail.server.bandwidthLimitBytes / 1_000_000_000)
      )
      setErrors({})
      setManagementKey("")
      setApiUrlErrors({})
    }
  }, [open, detail])

  const trimmedName = name.trim()

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
  const currentBandwidthLimitGb =
    detail?.server.bandwidthLimitBytes === null || detail === undefined
      ? ""
      : String(detail.server.bandwidthLimitBytes / 1_000_000_000)

  const nameChanged = trimmedName !== (detail?.server.name ?? "")
  const costChanged = costUsd.trim() !== currentCost
  const maxKeysChanged = maxKeys.trim() !== currentMaxKeys
  const defaultPriceMmkChanged =
    defaultPriceMmk.trim() !== currentDefaultPriceMmk
  const bandwidthLimitGbChanged =
    bandwidthLimitGb.trim() !== currentBandwidthLimitGb
  const nothingToDo =
    !nameChanged &&
    !costChanged &&
    !maxKeysChanged &&
    !defaultPriceMmkChanged &&
    !bandwidthLimitGbChanged

  // The domain a fresh "bind" pushes is always the server's own API-URL
  // domain — never something typed by hand, so there's nothing to mistype or
  // point at someone else's server.
  const domain = detail?.hostname ?? ""
  const boundHost = detail?.accessKeyHostname ?? ""
  const domainBound = boundHost !== "" && boundHost === domain

  // "Absent" and "explicitly none" can't both be nil on the wire, so removing a
  // ceiling (or a default price) is its own flag rather than a null value.
  const clearingMaxKeys = maxKeysChanged && maxKeys.trim() === ""
  const parsedMaxKeys = toNullableNumber(maxKeys)
  const clearingDefaultPriceMmk =
    defaultPriceMmkChanged && defaultPriceMmk.trim() === ""
  const parsedDefaultPriceMmk = toNullableNumber(defaultPriceMmk)
  const clearingBandwidthLimitGb =
    bandwidthLimitGbChanged && bandwidthLimitGb.trim() === ""
  const parsedBandwidthLimitGb = toNullableNumber(bandwidthLimitGb)

  const keyCount = detail?.keys.length ?? 0
  const belowKeyCount = parsedMaxKeys !== null && parsedMaxKeys < keyCount

  const save = useMutation({
    mutationFn: async () => {
      if (isMock) return mockUpdateServerConfig()
      return apiClient.patch(`servers/${serverId}/config`, {
        ...(nameChanged ? { name: trimmedName } : {}),
        ...(costChanged ? { costUsdPerMonth: toNullableNumber(costUsd) } : {}),
        ...(maxKeysChanged && !clearingMaxKeys
          ? { maxKeys: parsedMaxKeys }
          : {}),
        ...(clearingMaxKeys ? { clearMaxKeys: true } : {}),
        ...(defaultPriceMmkChanged && !clearingDefaultPriceMmk
          ? { defaultPriceMmk: parsedDefaultPriceMmk }
          : {}),
        ...(clearingDefaultPriceMmk ? { clearDefaultPriceMmk: true } : {}),
        ...(bandwidthLimitGbChanged && !clearingBandwidthLimitGb
          ? { bandwidthLimitGb: parsedBandwidthLimitGb }
          : {}),
        ...(clearingBandwidthLimitGb ? { clearBandwidthLimit: true } : {}),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      onOpenChange(false)
    },
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  // Its own mutation, independent of the rest of the form: binding the
  // domain is a one-click fix an admin should be able to fire without also
  // having to touch (or accidentally submit) name/cost/limit edits.
  const bindDomain = useMutation({
    mutationFn: async () => {
      if (isMock) return mockUpdateServerConfig(domain)
      return apiClient.patch(`servers/${serverId}/config`, {
        hostnameForAccessKeys: domain,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      // Every key's static link's host just changed — the user pages embed
      // that same key data and go stale otherwise.
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
  })

  // Repoints this server at a new Outline management key — e.g. after the
  // underlying box got a new IP on AWS — without deleting and re-adding it,
  // which would otherwise be the only way to change apiUrl/certSha256 and
  // risks hitting "this server has already been added" if the old row is
  // still active. Backend re-verifies reachability + cert pin before writing
  // anything, same as adding a fresh server.
  const updateAPIURL = useMutation({
    mutationFn: async () => {
      if (isMock) return mockUpdateServerConfig()
      return apiClient.patch(`servers/${serverId}/api-url`, {
        apiUrl: managementKey.trim(),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      setManagementKey("")
      setApiUrlErrors({})
    },
    onError: (error) => setApiUrlErrors(fieldErrorsFrom(error)),
  })

  const parsedCost = Number(costUsd)
  const mmk = Number.isFinite(parsedCost) ? parsedCost * mmkPerUsd : 0

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
                <FieldDescription>{errors.name ?? ""}</FieldDescription>
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
                    `Converted at ${mmkPerUsd.toLocaleString("en-US")} MMK per $1 — used on the Revenue page. Editable in Settings.`}
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
                    aria-invalid={
                      !!errors.maxKeys || belowKeyCount || undefined
                    }
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

              <Field data-invalid={!!errors.bandwidthLimitGb || undefined}>
                <FieldLabel htmlFor="edit-server-bandwidth-limit">
                  Bandwidth limit (per month)
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="edit-server-bandwidth-limit"
                    type="number"
                    min={1}
                    step="any"
                    inputMode="decimal"
                    placeholder="Not tracked"
                    value={bandwidthLimitGb}
                    aria-invalid={!!errors.bandwidthLimitGb || undefined}
                    onChange={(e) => setBandwidthLimitGb(e.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>GB</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  {errors.bandwidthLimitGb ??
                    "Total transfer (in + out) allowed each calendar month. Every key on this server is automatically disabled once usage gets within 2 GB of this — you re-enable them manually. Leave blank to stop tracking it."}
                </FieldDescription>
              </Field>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Outline management key</FieldLegend>
              <Field data-invalid={!!apiUrlErrors.apiUrl || undefined}>
                <FieldLabel htmlFor="edit-server-management-key">
                  Update connection (e.g. after the box gets a new IP)
                </FieldLabel>
                <Textarea
                  id="edit-server-management-key"
                  className="font-mono text-xs"
                  placeholder="Paste the new Outline install management key JSON, or just its apiUrl"
                  autoComplete="off"
                  spellCheck={false}
                  value={managementKey}
                  aria-invalid={!!apiUrlErrors.apiUrl || undefined}
                  onChange={(e) => setManagementKey(e.target.value)}
                />
                <FieldDescription>
                  {apiUrlErrors.apiUrl ??
                    "Only needed if this server was reinstalled or its IP changed and the old management key stopped connecting. Leave blank otherwise — this never runs unless you paste something here."}
                </FieldDescription>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={
                    updateAPIURL.isPending || managementKey.trim() === ""
                  }
                  onClick={() => updateAPIURL.mutate()}
                >
                  {updateAPIURL.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <RefreshCwIcon data-icon="inline-start" />
                  )}
                  Verify &amp; update management key
                </Button>
              </Field>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Static access link</FieldLegend>
              <Field>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Bound to</span>
                  <Badge variant={domainBound ? "secondary" : "destructive"}>
                    {boundHost || "Not set"}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {domain || "—"} resolves to
                  </span>
                  <span className="font-mono">
                    {detail?.resolvedIp || "—"}
                  </span>
                </div>
                {domainBound ? (
                  <FieldDescription>
                    Every static key on this server is bound to its own
                    domain, so it keeps working if the underlying IP ever
                    changes.
                  </FieldDescription>
                ) : (
                  <Alert variant="destructive">
                    <AlertTitle>Static keys aren't on this domain</AlertTitle>
                    <AlertDescription>
                      {boundHost
                        ? `Static keys are bound to "${boundHost}", not this server's own domain (${domain}). If that host's IP ever changes, every distributed key breaks.`
                        : `No access key carries a host yet — new keys won't have one until this is bound.`}
                    </AlertDescription>
                  </Alert>
                )}
                {!domainBound && domain && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    disabled={bindDomain.isPending}
                    onClick={() => bindDomain.mutate()}
                  >
                    {bindDomain.isPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <RefreshCwIcon data-icon="inline-start" />
                    )}
                    Bind static keys to {domain}
                  </Button>
                )}
                {bindDomain.isError && (
                  <FieldDescription className="text-destructive">
                    Outline rejected that hostname — try again once the
                    server is reachable.
                  </FieldDescription>
                )}
              </Field>
            </FieldSet>
          </FieldGroup>

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={save.isPending}
                >
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
