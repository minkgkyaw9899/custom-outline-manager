import { cn } from "@/lib/utils"

/**
 * Bar sparkline where the most recent `highlightCount` bars are called out in
 * `highlightClassName` and the rest sit muted behind them.
 */
export function Sparkline({
  values,
  highlightCount = 2,
  highlightClassName = "bg-chart-1",
  className,
}: Readonly<{
  values: number[]
  highlightCount?: number
  highlightClassName?: string
  className?: string
}>) {
  const max = Math.max(...values, 1)

  return (
    <div aria-hidden className={cn("flex h-12 items-end gap-1", className)}>
      {values.map((v, i) => (
        <div
          key={i}
          className={cn(
            "min-h-1 flex-1 rounded-xs",
            i >= values.length - highlightCount ? highlightClassName : "bg-muted",
          )}
          style={{ height: `${(v / max) * 100}%` }}
        />
      ))}
    </div>
  )
}
