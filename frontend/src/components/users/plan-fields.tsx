import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { MIN_PLAN_DAYS, MIN_PLAN_GB } from "@/lib/format"

/**
 * The data-allowance and validity pair, shared by every dialog that provisions
 * a key for a user: creating one, adding another, and swapping servers.
 *
 * The backend enforces the same floor on all three routes, so the inputs are
 * pre-filled with it rather than left blank, and flag anything below it before
 * the request is made.
 */
export function PlanFields({
  idPrefix,
  limitGb,
  days,
  onLimitGbChange,
  onDaysChange,
  errors,
}: Readonly<{
  idPrefix: string
  limitGb: string
  days: string
  onLimitGbChange: (value: string) => void
  onDaysChange: (value: string) => void
  errors: Record<string, string | undefined>
}>) {
  const gb = Number(limitGb) || 0
  const addDays = Number(days) || 0

  return (
    <>
      <Field data-invalid={!!errors.add_gb || undefined}>
        <FieldLabel htmlFor={`${idPrefix}-limit`}>Data limit</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={`${idPrefix}-limit`}
            type="number"
            min={MIN_PLAN_GB}
            // A numeric step would make the browser reject anything that is not
            // floor + n*step — see edit-key-dialog.
            step="any"
            inputMode="decimal"
            value={limitGb}
            aria-invalid={gb < MIN_PLAN_GB || undefined}
            onChange={(e) => onLimitGbChange(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>GB</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        {(errors.add_gb || gb < MIN_PLAN_GB) && (
          <FieldDescription>
            {errors.add_gb ?? `A key starts at ${MIN_PLAN_GB} GB or more.`}
          </FieldDescription>
        )}
      </Field>

      <Field data-invalid={!!errors.add_days || undefined}>
        <FieldLabel htmlFor={`${idPrefix}-days`}>Valid for</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={`${idPrefix}-days`}
            type="number"
            min={MIN_PLAN_DAYS}
            step={1}
            inputMode="numeric"
            value={days}
            aria-invalid={addDays < MIN_PLAN_DAYS || undefined}
            onChange={(e) => onDaysChange(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>days</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        {(errors.add_days || addDays < MIN_PLAN_DAYS) && (
          <FieldDescription>
            {errors.add_days ?? `A key runs for ${MIN_PLAN_DAYS} days or more.`}
          </FieldDescription>
        )}
      </Field>
    </>
  )
}

/** True when either allowance is under the plan floor the backend enforces. */
export function isBelowPlanFloor(limitGb: string, days: string): boolean {
  return (Number(limitGb) || 0) < MIN_PLAN_GB || (Number(days) || 0) < MIN_PLAN_DAYS
}
