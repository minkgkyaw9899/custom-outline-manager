import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"

import { isBelowPlanFloor, PlanFields } from "@/components/users/plan-fields"
import { ServerSelect } from "@/components/users/server-select"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  formatBytesCompact,
  formatDateOnly,
  MIN_PLAN_DAYS,
  MIN_PLAN_GB,
} from "@/lib/format"
import { unassignedKeysQueryOptions } from "@/lib/queries"
import type { Key } from "@/lib/types"

/**
 * Where a holder's key comes from: a brand new one on the chosen server, or an
 * existing key on it that belongs to nobody. Not a choice the admin makes —
 * KeySourceFields derives it from whether the server has a free key and picks
 * accordingly, only surfacing a picker when there's more than one candidate.
 *
 * Free keys are the ones adopted from the Outline server itself, or released
 * when a previous holder was moved or deleted, or provisioned ahead of need
 * and never used. Handing one of those over costs nothing and keeps the
 * allowance it already carries, so it is used before provisioning yet
 * another key against the server's ceiling.
 */
export type KeySourceMode = "new" | "existing"

export interface KeySourceState {
  serverId: string
  mode: KeySourceMode
  keyId: string
  keyName: string
  limitGb: string
  days: string
}

export function initialKeySource(): KeySourceState {
  return {
    serverId: "",
    mode: "new",
    keyId: "",
    keyName: "",
    limitGb: String(MIN_PLAN_GB),
    days: String(MIN_PLAN_DAYS),
  }
}

/**
 * The request-body fragment for this choice, ready to spread into a payload.
 *
 * `includePlan` sends the data limit and expiry alongside a claimed key too,
 * so the backend overrides whatever allowance it was left carrying instead of
 * keeping it as-is — used for a new user, not for moving an existing one onto
 * a different key (see overridePlanOnClaim on KeySourceFields).
 */
export function keySourcePayload(
  state: KeySourceState,
  options: { includePlan?: boolean } = {},
): Record<string, unknown> {
  if (state.mode === "existing") {
    if (!options.includePlan) return { keyId: state.keyId }
    return {
      keyId: state.keyId,
      add_gb: Number(state.limitGb) || 0,
      add_days: Number(state.days) || 0,
    }
  }
  return {
    serverId: state.serverId,
    name: state.keyName.trim(),
    add_gb: Number(state.limitGb) || 0,
    add_days: Number(state.days) || 0,
  }
}

/** True while the choice can't be submitted yet. */
export function isKeySourceIncomplete(
  state: KeySourceState,
  options: { requirePlan?: boolean } = {},
): boolean {
  if (!state.serverId) return true
  if (state.mode === "existing") {
    if (!state.keyId) return true
    return options.requirePlan ? isBelowPlanFloor(state.limitGb, state.days) : false
  }
  return isBelowPlanFloor(state.limitGb, state.days)
}

function freeKeyLabel(key: Key): string {
  const quota =
    key.customLimitBytes === null
      ? "no limit"
      : `${formatBytesCompact(key.customLimitBytes)} limit`
  const expiry = key.endDate ? `expires ${formatDateOnly(key.endDate)}` : "no expiry"
  return `${key.name || key.outlineKeyId} — ${quota} · ${expiry}`
}

export function KeySourceFields({
  value,
  onChange,
  errors,
  idPrefix,
  keyNamePlaceholder,
  serverLabel = "Server",
  overridePlanOnClaim = false,
}: Readonly<{
  value: KeySourceState
  onChange: (next: KeySourceState) => void
  errors: Record<string, string | undefined>
  idPrefix: string
  keyNamePlaceholder: string
  serverLabel?: string
  /**
   * Show and apply a data limit / valid-for plan even when the key comes
   * from claiming a free one, overriding whatever it already carries — for a
   * brand new holder, who should start on the same standard plan regardless
   * of where their key came from. Off by default: moving an existing holder
   * onto a different free key keeps that key's allowance as-is.
   */
  overridePlanOnClaim?: boolean
}>) {
  const { data: unassigned } = useQuery(unassignedKeysQueryOptions())

  // Filtered client-side: the picker only offers keys on the server already
  // chosen above, and the whole unassigned list is small enough that a
  // per-server round trip would buy nothing.
  const freeKeys = (unassigned ?? []).filter((k) => k.serverId === value.serverId)

  // Keys that were provisioned but never used and never handed to anyone —
  // spare capacity a full server can still offer instead of a new key.
  const claimableKeyCounts = (unassigned ?? []).reduce<Record<string, number>>(
    (acc, k) => {
      if (k.usedBytes === 0) acc[k.serverId] = (acc[k.serverId] ?? 0) + 1
      return acc
    },
    {},
  )

  const set = (patch: Partial<KeySourceState>) => onChange({ ...value, ...patch })

  // The source isn't a choice the admin makes: reusing a free key already on
  // the server always wins over provisioning a new one. Only when more than
  // one free key exists is there anything left to pick — which one.
  const freeKeyIds = freeKeys.map((k) => k.id).join(",")
  useEffect(() => {
    if (!value.serverId) return
    if (freeKeys.length === 0) {
      if (value.mode !== "new" || value.keyId !== "") set({ mode: "new", keyId: "" })
      return
    }
    if (freeKeys.length === 1) {
      if (value.mode !== "existing" || value.keyId !== freeKeys[0].id) {
        set({ mode: "existing", keyId: freeKeys[0].id })
      }
      return
    }
    const keyStillFree = freeKeys.some((k) => k.id === value.keyId)
    if (value.mode !== "existing" || !keyStillFree) {
      set({ mode: "existing", keyId: keyStillFree ? value.keyId : "" })
    }
    // Re-derive whenever the server changes or its pool of free keys does —
    // not on every keystroke in the unrelated fields below.
  }, [value.serverId, freeKeyIds])

  return (
    <>
      <ServerSelect
        id={`${idPrefix}-server`}
        label={serverLabel}
        value={value.serverId}
        onValueChange={(serverId) => set({ serverId, keyId: "" })}
        error={errors.serverId}
        claimableKeyCounts={claimableKeyCounts}
        description=""
      />

      {value.serverId && value.mode === "existing" && (
        <>
          <Field data-invalid={!!errors.keyId || undefined}>
            <FieldLabel htmlFor={`${idPrefix}-free-key`}>Key</FieldLabel>
            {freeKeys.length <= 1 ? (
              <FieldDescription>
                {freeKeys[0]
                  ? overridePlanOnClaim
                    ? `Using the spare key already on this server: ${freeKeys[0].name || freeKeys[0].outlineKeyId}`
                    : `Using the spare key already on this server: ${freeKeyLabel(freeKeys[0])}`
                  : ""}
              </FieldDescription>
            ) : (
              <>
                <Select
                  value={value.keyId}
                  onValueChange={(v) => set({ keyId: v ?? "" })}
                >
                  <SelectTrigger
                    id={`${idPrefix}-free-key`}
                    aria-invalid={!!errors.keyId || undefined}
                  >
                    <SelectValue placeholder="Choose a free key">
                      {(selected: string) => {
                        const key = freeKeys.find((k) => k.id === selected)
                        return key ? key.name || key.outlineKeyId : "Choose a free key"
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {freeKeys.map((key) => (
                        <SelectItem key={key.id} value={key.id}>
                          {freeKeyLabel(key)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {errors.keyId ??
                    (overridePlanOnClaim
                      ? "This server has more than one spare key — the plan below replaces whatever it already carries."
                      : "This server has more than one spare key — its limit and expiry come with it.")}
                </FieldDescription>
              </>
            )}
          </Field>

          {overridePlanOnClaim && (
            <PlanFields
              idPrefix={idPrefix}
              limitGb={value.limitGb}
              days={value.days}
              onLimitGbChange={(limitGb) => set({ limitGb })}
              onDaysChange={(days) => set({ days })}
              errors={errors}
            />
          )}
        </>
      )}

      {value.serverId && value.mode === "new" && (
        <>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-key-name`}>
              Key name (optional)
            </FieldLabel>
            <Input
              id={`${idPrefix}-key-name`}
              autoComplete="off"
              placeholder={keyNamePlaceholder}
              value={value.keyName}
              onChange={(e) => set({ keyName: e.target.value })}
            />
            <FieldDescription>
              What the key is called in Outline. Defaults to their name.
            </FieldDescription>
          </Field>

          <PlanFields
            idPrefix={idPrefix}
            limitGb={value.limitGb}
            days={value.days}
            onLimitGbChange={(limitGb) => set({ limitGb })}
            onDaysChange={(days) => set({ days })}
            errors={errors}
          />
        </>
      )}
    </>
  )
}
