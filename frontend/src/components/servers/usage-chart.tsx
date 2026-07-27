import { Area, AreaChart, XAxis } from "recharts"

import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import type { ChartConfig } from "@/components/ui/chart"
import { formatBytesCompact } from "@/lib/format"
import type { DailyUsage, UsageGranularity } from "@/lib/types"

const chartConfig = {
  bytes: { label: "Traffic", color: "var(--chart-1)" },
} satisfies ChartConfig

/**
 * Traffic for one server or key, bucketed by day (the default) or by hour for
 * a key under a day old (see UsageGranularity).
 *
 * The series comes from our own usage_snapshots history, not from Outline —
 * Outline returns only window aggregates. A bucket needs the previous
 * bucket's snapshot to produce a delta, so a newly-added server or key shows
 * the empty state until the cron has run across two buckets.
 */
export function UsageChart({
  series,
  granularity = "day",
  className,
}: Readonly<{
  series: DailyUsage[]
  granularity?: UsageGranularity
  className?: string
}>) {
  if (series.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed">
        <p className="px-4 text-center text-xs text-muted-foreground">
          {granularity === "hour"
            ? "Hourly traffic appears once this key has a couple of syncs behind it."
            : "Daily traffic appears once this server has a couple of days of sync history."}
        </p>
      </div>
    )
  }

  const data = series.map((point) => ({
    ...point,
    label:
      granularity === "hour"
        ? new Date(point.date).toLocaleTimeString(undefined, { hour: "numeric" })
        : new Date(point.date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
  }))

  return (
    <ChartContainer config={chartConfig} className={className ?? "h-24 w-full"}>
      <AreaChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="fillServerUsage" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-bytes)" stopOpacity={0.4} />
            <stop offset="95%" stopColor="var(--color-bytes)" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" hide />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelKey="label"
              formatter={(value) => formatBytesCompact(Number(value))}
            />
          }
        />
        <Area
          dataKey="bytes"
          type="monotone"
          fill="url(#fillServerUsage)"
          stroke="var(--color-bytes)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  )
}
