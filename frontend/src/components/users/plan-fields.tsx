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
 * Creating and adding keys are held to the plan floor the backend enforces, so
 * the inputs are pre-filled with it and flag anything below it before the
 * request is made. Swapping servers passes `enforcePlanFloor={false}`: that
 * carries over whatever was left on the old key, so any positive amount goes.
 */
export function PlanFields({
  idPrefix,
  limitGb,
  days,
  onLimitGbChange,
  onDaysChange,
  errors,
  enforcePlanFloor = true,
}: Readonly<{
  idPrefix: string
  limitGb: string
  days: string
  onLimitGbChange: (value: string) => void
  onDaysChange: (value: string) => void
  errors: Record<string, string | undefined>
  enforcePlanFloor?: boolean
}>) {
  const gb = Number(limitGb) || 0
  const addDays = Number(days) || 0
  const { minGb, minDays } = planMinimums(enforcePlanFloor)
  const gbHint = enforcePlanFloor
    ? `A key starts at ${MIN_PLAN_GB} GB or more.`
    : "Enter more than 0 GB."
  const daysHint = enforcePlanFloor
    ? `A key runs for ${MIN_PLAN_DAYS} days or more.`
    : "Enter at least 1 day."

  return (
    <>
      <Field data-invalid={!!errors.add_gb || undefined}>
        <FieldLabel htmlFor={`${idPrefix}-limit`}>Data limit</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={`${idPrefix}-limit`}
            type="number"
            min={enforcePlanFloor ? MIN_PLAN_GB : 0}
            // A numeric step would make the browser reject anything that is not
            // floor + n*step — see edit-key-dialog.
            step="any"
            inputMode="decimal"
            value={limitGb}
            aria-invalid={gb < minGb || undefined}
            onChange={(e) => onLimitGbChange(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>GB</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        {(errors.add_gb || gb < minGb) && (
          <FieldDescription>{errors.add_gb ?? gbHint}</FieldDescription>
        )}
      </Field>

      <Field data-invalid={!!errors.add_days || undefined}>
        <FieldLabel htmlFor={`${idPrefix}-days`}>Valid for</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={`${idPrefix}-days`}
            type="number"
            min={minDays}
            step={1}
            inputMode="numeric"
            value={days}
            aria-invalid={addDays < minDays || undefined}
            onChange={(e) => onDaysChange(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>days</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        {(errors.add_days || addDays < minDays) && (
          <FieldDescription>{errors.add_days ?? daysHint}</FieldDescription>
        )}
      </Field>
    </>
  )
}

// Without the plan floor the smallest usable amount is "anything at all" for
// data (Number.MIN_VALUE, so 0 still fails) and one whole day for validity.
function planMinimums(enforcePlanFloor: boolean) {
  return enforcePlanFloor
    ? { minGb: MIN_PLAN_GB, minDays: MIN_PLAN_DAYS }
    : { minGb: Number.MIN_VALUE, minDays: 1 }
}

/**
 * True when either allowance is under the plan floor the backend enforces —
 * or, with `enforcePlanFloor` off, when either one is empty or zero.
 */
export function isBelowPlanFloor(
  limitGb: string,
  days: string,
  enforcePlanFloor = true
): boolean {
  const { minGb, minDays } = planMinimums(enforcePlanFloor)
  return (Number(limitGb) || 0) < minGb || (Number(days) || 0) < minDays
}
