import { Button } from "@/components/ui/button"
import { PLAN_PRESETS } from "@/lib/plan-presets"

/** One-click GB/days fill for the new-key and renew dialogs. */
export function PlanPresetPicker({
  onPick,
}: Readonly<{ onPick: (gb: number, days: number) => void }>) {
  return (
    <div className="flex flex-wrap gap-2">
      {PLAN_PRESETS.map((preset) => (
        <Button
          key={preset.label}
          type="button"
          variant="outline"
          size="sm"
          className="text-xs tracking-normal normal-case"
          onClick={() => onPick(preset.gb, preset.days)}
        >
          {preset.label} · {preset.gb} GB
        </Button>
      ))}
    </div>
  )
}
