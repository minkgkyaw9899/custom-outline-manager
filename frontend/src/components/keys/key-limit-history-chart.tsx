import { useMemo } from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import type { ChartConfig } from "@/components/ui/chart"
import { formatBytesCompact, formatDateOnly } from "@/lib/format"
import type { RenewalLog } from "@/lib/types"

const chartConfig = {
  limit: { label: "Data limit", color: "var(--chart-2)" },
} satisfies ChartConfig

/** How this key's data limit moved with each renewal, from the renewal log. */
export function KeyLimitHistoryChart({
  renewals,
}: Readonly<{ renewals: RenewalLog[] }>) {
  const data = useMemo(
    () =>
      [...renewals]
        .filter((r) => r.newLimitBytes !== null)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((r) => ({
          label: formatDateOnly(r.createdAt),
          limit: r.newLimitBytes as number,
        })),
    [renewals],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Limit history</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length < 2 ? (
          <p className="flex h-40 items-center justify-center text-center text-sm text-muted-foreground">
            Needs at least two renewals to chart a trend.
          </p>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="h-40 w-full [&_.recharts-cartesian-axis-tick_text]:font-mono"
          >
            <LineChart data={data} margin={{ left: 4, right: 12, top: 12 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                minTickGap={24}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={54}
                tickFormatter={(v: number) => (v === 0 ? "0" : formatBytesCompact(v))}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => formatBytesCompact(Number(value), { decimals: 1 })}
                    labelKey="label"
                  />
                }
              />
              <Line
                dataKey="limit"
                type="stepAfter"
                stroke="var(--color-limit)"
                strokeWidth={2}
                dot={{ r: 3, fill: "var(--color-limit)", strokeWidth: 0 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
