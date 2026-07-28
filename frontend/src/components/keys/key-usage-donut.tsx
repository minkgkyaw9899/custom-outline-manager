import { useMemo } from "react"
import { Cell, Pie, PieChart } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import type { ChartConfig } from "@/components/ui/chart"
import { ChartLegendDot } from "@/components/dashboard/chart-legend-dot"
import { formatBytesCompact } from "@/lib/format"

const chartConfig = {
  used: { label: "Used", color: "var(--chart-1)" },
  remaining: { label: "Remaining", color: "var(--muted)" },
} satisfies ChartConfig

/**
 * Used vs. remaining quota for one key, as a donut with the percentage at its
 * center. Takes just the two figures it needs (not the full admin `Key`
 * shape) so the public share view can reuse it too.
 */
export function KeyUsageDonut({
  keyItem,
}: Readonly<{
  keyItem: { usedBytes: number; customLimitBytes: number | null }
}>) {
  const { usedBytes, customLimitBytes } = keyItem

  const data = useMemo(() => {
    if (customLimitBytes === null) return null
    const used = Math.min(usedBytes, customLimitBytes)
    const remaining = Math.max(customLimitBytes - usedBytes, 0)
    return [
      { key: "used", label: "Used", bytes: used, fill: "var(--color-used)" },
      { key: "remaining", label: "Remaining", bytes: remaining, fill: "var(--color-remaining)" },
    ]
  }, [usedBytes, customLimitBytes])

  const pct =
    customLimitBytes === null || customLimitBytes === 0
      ? 0
      : Math.min(100, Math.round((usedBytes / customLimitBytes) * 100))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Quota</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        {data === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No data limit set on this key.
          </p>
        ) : (
          <>
            <div className="relative">
              <ChartContainer config={chartConfig} className="mx-auto aspect-square h-48">
                <PieChart>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        hideLabel
                        formatter={(value, _name, item) => (
                          <span className="flex w-full items-center gap-2">
                            <span
                              aria-hidden
                              className="size-2.5 shrink-0 rounded-[2px]"
                              style={{ backgroundColor: String(item.payload?.fill) }}
                            />
                            <span className="text-muted-foreground">
                              {item.payload?.label}
                            </span>
                            <span className="ml-auto font-mono tabular-nums">
                              {formatBytesCompact(Number(value), { decimals: 1 })}
                            </span>
                          </span>
                        )}
                      />
                    }
                  />
                  <Pie
                    data={data}
                    dataKey="bytes"
                    nameKey="label"
                    innerRadius={62}
                    outerRadius={88}
                    strokeWidth={2}
                    stroke="var(--card)"
                  >
                    {data.map((entry) => (
                      <Cell key={entry.key} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-heading text-2xl font-bold tabular-nums">{pct}%</span>
                <span className="text-xs text-muted-foreground">used</span>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
              <ChartLegendDot color="var(--chart-1)" label="Used" />
              <ChartLegendDot color="var(--muted)" label="Remaining" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
