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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
 * existing key on it that belongs to nobody.
 *
 * Free keys are the ones adopted from the Outline server itself, or released
 * when a previous holder was moved or deleted. Handing one of those over costs
 * nothing and keeps the allowance it already carries, so it is worth offering
 * before provisioning yet another key against the server's ceiling.
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

/** The request-body fragment for this choice, ready to spread into a payload. */
export function keySourcePayload(state: KeySourceState): Record<string, unknown> {
  if (state.mode === "existing") {
    // The key already has a server, a name and an allowance — naming it is the
    // whole instruction.
    return { keyId: state.keyId }
  }
  return {
    serverId: state.serverId,
    name: state.keyName.trim(),
    add_gb: Number(state.limitGb) || 0,
    add_days: Number(state.days) || 0,
  }
}

/** True while the choice can't be submitted yet. */
export function isKeySourceIncomplete(state: KeySourceState): boolean {
  if (!state.serverId) return true
  if (state.mode === "existing") return !state.keyId
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
}: Readonly<{
  value: KeySourceState
  onChange: (next: KeySourceState) => void
  errors: Record<string, string | undefined>
  idPrefix: string
  keyNamePlaceholder: string
  serverLabel?: string
}>) {
  const { data: unassigned } = useQuery(unassignedKeysQueryOptions())

  // Filtered client-side: the picker only offers keys on the server already
  // chosen above, and the whole unassigned list is small enough that a
  // per-server round trip would buy nothing.
  const freeKeys = (unassigned ?? []).filter((k) => k.serverId === value.serverId)
  const set = (patch: Partial<KeySourceState>) => onChange({ ...value, ...patch })

  return (
    <>
      <ServerSelect
        id={`${idPrefix}-server`}
        label={serverLabel}
        value={value.serverId}
        onValueChange={(serverId) =>
          // The chosen key belongs to the old server, so it can't survive the
          // switch.
          set({ serverId, keyId: "" })
        }
        error={errors.serverId}
        description="Servers at their key limit can't be chosen for a new key."
      />

      {value.serverId && (
        <Field>
          <FieldLabel>Key</FieldLabel>
          <ToggleGroup
            value={[value.mode]}
            onValueChange={(v) => {
              if (v.length) set({ mode: v[0] as KeySourceMode, keyId: "" })
            }}
          >
            <ToggleGroupItem
              value="new"
              className="rounded-full border px-4 text-sm tracking-normal normal-case aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary"
            >
              Create new
            </ToggleGroupItem>
            <ToggleGroupItem
              value="existing"
              className="rounded-full border px-4 text-sm tracking-normal normal-case aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary"
            >
              Use a free key ({freeKeys.length})
            </ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>
            {value.mode === "new"
              ? "Creates a key on this server, counting against its key limit."
              : "Takes over a key on this server that belongs to nobody, keeping the allowance it already has."}
          </FieldDescription>
        </Field>
      )}

      {value.serverId && value.mode === "existing" && (
        <Field data-invalid={!!errors.keyId || undefined}>
          <FieldLabel htmlFor={`${idPrefix}-free-key`}>Free key</FieldLabel>
          {freeKeys.length === 0 ? (
            <FieldDescription>
              Every key on this server already has a holder. Create a new one
              instead, or release a key from its holder first.
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
                  "Its limit and expiry come with it — edit them afterwards if the holder is on a different plan."}
              </FieldDescription>
            </>
          )}
        </Field>
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
