import { useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"

import { ChartLegendDot } from "@/components/dashboard/chart-legend-dot"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useMmkPerUsd } from "@/lib/queries"
import type { ServerWithUsage } from "@/lib/types"

type ChartType = "line" | "bar"
type Granularity = "day" | "month" | "year"

const CHART_TYPE_ITEMS = { line: "Line chart", bar: "Bar chart" }

const mmk = (n: number) => `${Math.round(n).toLocaleString("en-US")} MMK`

interface Point {
  date: string
  revenueMmk: number
  costMmk: number
}

/** Sums every server's reading for a given day — cron snapshots every server in the same tick, so dates line up. */
function mergeByDate(servers: ServerWithUsage[], mmkPerUsd: number): Point[] {
  const byDate = new Map<string, Point>()
  for (const server of servers) {
    for (const p of server.revenueDailySeries) {
      const costMmk = (p.costUsdPerMonth ?? 0) * mmkPerUsd
      const existing = byDate.get(p.date)
      byDate.set(p.date, {
        date: p.date,
        revenueMmk: (existing?.revenueMmk ?? 0) + p.revenueMmk,
        costMmk: (existing?.costMmk ?? 0) + costMmk,
      })
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function periodKey(date: string, granularity: Granularity): string {
  if (granularity === "year") return date.slice(0, 4)
  if (granularity === "month") return date.slice(0, 7)
  return date
}

function periodLabel(key: string, granularity: Granularity): string {
  if (granularity === "year") return key
  if (granularity === "month") {
    const [year, month] = key.split("-")
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(
      undefined,
      {
        month: "short",
        year: "numeric",
      }
    )
  }
  return new Date(key).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

/** Revenue is a level, not a delta — a coarser period takes its latest reading, never a sum of readings. */
function resample(points: Point[], granularity: Granularity): Point[] {
  if (granularity === "day") return points
  const byPeriod = new Map<string, Point>()
  for (const p of points) byPeriod.set(periodKey(p.date, granularity), p)
  return [...byPeriod.entries()].map(([key, p]) => ({ ...p, date: key }))
}

export function RevenueTrendCard({
  servers,
  title = "Revenue trend",
  description = "Revenue, cost and profit over time — one reading per cron tick, so a real trend builds up day by day.",
}: Readonly<{
  servers: ServerWithUsage[]
  title?: string
  description?: string
}>) {
  const mmkPerUsd = useMmkPerUsd()
  const [granularity, setGranularity] = useState<Granularity>("day")
  const [chartType, setChartType] = useState<ChartType>("line")

  const merged = useMemo(
    () => mergeByDate(servers, mmkPerUsd),
    [servers, mmkPerUsd]
  )
  const resampled = useMemo(
    () => resample(merged, granularity),
    [merged, granularity]
  )

  const data = resampled.map((p) => ({
    label: periodLabel(p.date, granularity),
    revenue: p.revenueMmk,
    cost: p.costMmk,
    profit: p.revenueMmk - p.costMmk,
  }))

  const chartConfig = {
    revenue: { label: "Revenue", color: "var(--chart-1)" },
    cost: { label: "Cost", color: "var(--chart-3)" },
    profit: { label: "Profit", color: "var(--chart-2)" },
  } satisfies ChartConfig

  const axes = (
    <>
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
        width={60}
        tickFormatter={(v: number) => (v === 0 ? "0" : mmk(v))}
      />
      <ChartTooltip
        content={
          <ChartTooltipContent
            formatter={(value) => mmk(Number(value))}
            labelKey="label"
          />
        }
      />
    </>
  )

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="font-heading text-lg">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-4">
            <ChartLegendDot color="var(--chart-1)" label="Revenue" />
            <ChartLegendDot color="var(--chart-3)" label="Cost" />
            <ChartLegendDot color="var(--chart-2)" label="Profit" />
          </div>
          <ToggleGroup
            value={[granularity]}
            onValueChange={(v) => {
              if (v.length) setGranularity(v[0] as Granularity)
            }}
          >
            <ToggleGroupItem
              value="day"
              className="text-sm tracking-normal normal-case"
            >
              Day
            </ToggleGroupItem>
            <ToggleGroupItem
              value="month"
              className="text-sm tracking-normal normal-case"
            >
              Month
            </ToggleGroupItem>
            <ToggleGroupItem
              value="year"
              className="text-sm tracking-normal normal-case"
            >
              Year
            </ToggleGroupItem>
          </ToggleGroup>
          <Select
            items={CHART_TYPE_ITEMS}
            value={chartType}
            onValueChange={(v) => setChartType(v as ChartType)}
          >
            <SelectTrigger size="sm" aria-label="Chart type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.entries(CHART_TYPE_ITEMS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            No revenue history yet — it builds up one reading per cron tick from
            here on.
          </p>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="h-72 w-full [&_.recharts-cartesian-axis-tick_text]:font-mono"
          >
            {chartType === "line" ? (
              <LineChart data={data} margin={{ left: 4, right: 12, top: 12 }}>
                {axes}
                <Line
                  dataKey="revenue"
                  type="monotone"
                  stroke="var(--color-revenue)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  dataKey="cost"
                  type="monotone"
                  stroke="var(--color-cost)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  dataKey="profit"
                  type="monotone"
                  stroke="var(--color-profit)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            ) : (
              <BarChart
                data={data}
                margin={{ left: 4, right: 12, top: 12 }}
                barGap={2}
              >
                {axes}
                <Bar
                  dataKey="revenue"
                  fill="var(--color-revenue)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={16}
                />
                <Bar
                  dataKey="cost"
                  fill="var(--color-cost)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={16}
                />
                <Bar
                  dataKey="profit"
                  fill="var(--color-profit)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={16}
                />
              </BarChart>
            )}
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
