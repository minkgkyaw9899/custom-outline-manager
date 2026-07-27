import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import type { ChartConfig } from "@/components/ui/chart"
import { ChartLegendDot } from "@/components/dashboard/chart-legend-dot"
import { formatBytesCompact } from "@/lib/format"
import type { ASUsage } from "@/lib/types"

// Same fixed order as AsShareList, so an AS keeps the same colour wherever it
// shows up on this server's page.
const AS_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-5)",
  "var(--chart-4)",
]

const MAX_SLICES = 6

const chartConfig = {} satisfies ChartConfig

/**
 * Bandwidth by AS as a bar chart, and each AS's share of it as a donut.
 * Complements AsTable's exact figures with a shape that's faster to scan.
 */
export function AsUsageCharts({
  ases,
  windowLabel,
}: Readonly<{ ases: ASUsage[]; windowLabel: string }>) {
  const top = useMemo(
    () =>
      [...ases]
        .sort((a, b) => b.bytesTransferred - a.bytesTransferred)
        .slice(0, MAX_SLICES)
        .map((as, i) => ({
          asOrg: as.asOrg,
          label: as.asOrg.length > 20 ? `AS${as.asn}` : as.asOrg,
          bytes: as.bytesTransferred,
          sharePct: as.sharePct,
          fill: AS_COLORS[i % AS_COLORS.length],
        })),
    [ases],
  )

  if (ases.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">AS traffic breakdown</CardTitle>
        <CardDescription>
          Bandwidth by autonomous system, last {windowLabel}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-8 lg:grid-cols-2">
        <ChartContainer config={chartConfig} className="h-64 w-full">
          <BarChart data={top} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => (v === 0 ? "0" : formatBytesCompact(v))}
            />
            <YAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
              width={110}
            />
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
                        {item.payload?.asOrg}
                      </span>
                      <span className="ml-auto font-mono tabular-nums">
                        {formatBytesCompact(Number(value))}
                      </span>
                    </span>
                  )}
                />
              }
            />
            <Bar dataKey="bytes" radius={[0, 4, 4, 0]} maxBarSize={18}>
              {top.map((entry) => (
                <Cell key={entry.asOrg} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>

        <div className="flex flex-col items-center gap-3">
          <ChartContainer config={chartConfig} className="mx-auto aspect-square h-56">
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
                          {item.payload?.asOrg}
                        </span>
                        <span className="ml-auto font-mono tabular-nums">
                          {Math.round(Number(value))}%
                        </span>
                      </span>
                    )}
                  />
                }
              />
              <Pie
                data={top}
                dataKey="sharePct"
                nameKey="asOrg"
                innerRadius={50}
                outerRadius={80}
                strokeWidth={2}
                stroke="var(--card)"
              >
                {top.map((entry) => (
                  <Cell key={entry.asOrg} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
            {top.map((entry) => (
              <ChartLegendDot key={entry.asOrg} color={entry.fill} label={entry.asOrg} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
