import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { ChartConfig } from "@/components/ui/chart"
import { StatCard } from "@/components/common/stat-card"
import type { RetentionMetrics } from "@/lib/types"

const chartConfig = {
  count: { label: "New holders", color: "var(--chart-1)" },
} satisfies ChartConfig

/**
 * Renewal-lapse rate, holder churn, new-holder trend, and average
 * active-holder tenure — the metrics that are honestly derivable from what's
 * actually stored (see models.RetentionMetrics on the backend for why there
 * is no currency-denominated LTV here).
 */
export function RetentionCard({
  metrics,
}: Readonly<{ metrics: RetentionMetrics }>) {
  const data = metrics.newHoldersSeries.map((p) => ({
    label: new Date(p.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    count: p.count,
  }))
  const newHoldersTotal = metrics.newHoldersSeries.reduce(
    (sum, p) => sum + p.count,
    0
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Retention</CardTitle>
        <CardDescription>
          Trailing {metrics.windowDays} days. Renewal-lapse rate is of keys that
          came up for renewal in the window; holder churn is of holders who had
          a live key sometime in the window.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
          <StatCard
            label="Renewal-lapse rate"
            value={`${metrics.renewalLapseRatePct.toFixed(0)}%`}
            note={`${metrics.lapsedCount} lapsed / ${metrics.renewedCount} renewed`}
          />
          <StatCard
            label="Holder churn"
            value={`${metrics.holderChurnRatePct.toFixed(0)}%`}
            note={`${metrics.churnedHolders} / ${metrics.consideredHolders} holders`}
          />
          <StatCard
            label="New holders"
            value={String(newHoldersTotal)}
            note={`In the last ${metrics.windowDays} days`}
          />
          <StatCard
            label="Avg. active holder tenure"
            value={`${Math.round(metrics.avgActiveHolderTenureDays)}d`}
            note="Holders with a currently active key"
          />
        </div>

        {data.length > 0 && (
          <ChartContainer
            config={chartConfig}
            className="h-40 w-full [&_.recharts-cartesian-axis-tick_text]:font-mono"
          >
            <BarChart data={data} margin={{ left: 4, right: 12, top: 12 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                minTickGap={28}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={28}
                allowDecimals={false}
              />
              <ChartTooltip
                content={<ChartTooltipContent labelKey="label" />}
              />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                radius={[3, 3, 0, 0]}
                maxBarSize={24}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
