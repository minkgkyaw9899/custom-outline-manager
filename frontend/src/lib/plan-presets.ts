import { MIN_PLAN_DAYS, MIN_PLAN_GB } from "@/lib/format"

/**
 * Quick-pick data tiers for the new-key and renew dialogs — fills the GB/days
 * fields in one click instead of typing them every time. Deliberately doesn't
 * touch price: that's set per key/server and varies by admin, not something
 * to guess a figure for here.
 *
 * GB scales off MIN_PLAN_GB rather than a hardcoded number, so these stay
 * sensible if the plan floor ever changes; days is fixed at one billing
 * period across every tier — only the data allowance changes.
 */
export interface PlanPreset {
  label: string
  gb: number
  days: number
}

export const PLAN_PRESETS: PlanPreset[] = [
  { label: "Standard", gb: MIN_PLAN_GB, days: MIN_PLAN_DAYS },
  { label: "Plus", gb: MIN_PLAN_GB * 2.5, days: MIN_PLAN_DAYS },
  { label: "Pro", gb: MIN_PLAN_GB * 5, days: MIN_PLAN_DAYS },
]
