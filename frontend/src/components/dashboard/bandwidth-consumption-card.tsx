import { useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { ChartLegendDot } from "@/components/dashboard/chart-legend-dot"
import { formatBytesCompact } from "@/lib/format"
import {
  DAY_LABELS,
  MONTH_LABELS,
  OVERVIEW_SERVERS,
  dailySeriesFor,
  monthlySeriesFor,
} from "@/lib/mock-dashboard"

type ChartType = "line" | "bar" | "area"
type Granularity = "daily" | "monthly"

const CHART_TYPE_ITEMS = {
  line: "Line chart",
  bar: "Bar chart",
  area: "Area chart",
}

const SERVER_ITEMS = Object.fromEntries(
  OVERVIEW_SERVERS.map((s) => [s.id, s.name]),
)

export function BandwidthConsumptionCard() {
  const [serverId, setServerId] = useState("new-york-03")
  const [chartType, setChartType] = useState<ChartType>("line")
  const [granularity, setGranularity] = useState<Granularity>("daily")

  const server = OVERVIEW_SERVERS.find((s) => s.id === serverId) ?? OVERVIEW_SERVERS[0]

  const chartConfig = {
    total: { label: `${server.name} total`, color: "var(--chart-3)" },
  } satisfies ChartConfig

  const data = useMemo(() => {
    const labels = granularity === "daily" ? DAY_LABELS : MONTH_LABELS
    const series =
      granularity === "daily" ? dailySeriesFor(serverId) : monthlySeriesFor(serverId)
    return labels.map((label, i) => ({ label, total: series[i] }))
  }, [serverId, granularity])

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
        width={54}
        tickFormatter={(v: number) => (v === 0 ? "0" : formatBytesCompact(v))}
      />
      <ChartTooltip
        content={
          <ChartTooltipContent
            formatter={(value) => formatBytesCompact(Number(value))}
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
          <CardTitle className="font-heading text-lg">Bandwidth consumption</CardTitle>
          <CardDescription>
            Per-server bandwidth · {server.name} · {granularity}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ChartLegendDot color="var(--chart-3)" label={`${server.name} total`} />
          <Select
            items={SERVER_ITEMS}
            value={serverId}
            onValueChange={(v) => setServerId(v as string)}
          >
            <SelectTrigger size="sm" aria-label="Server">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {OVERVIEW_SERVERS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
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
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[granularity]}
            onValueChange={(v) => {
              if (v.length) setGranularity(v[0] as Granularity)
            }}
          >
            <ToggleGroupItem value="daily" className="text-sm normal-case tracking-normal">
              Daily
            </ToggleGroupItem>
            <ToggleGroupItem value="monthly" className="text-sm normal-case tracking-normal">
              Monthly
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="h-80 w-full [&_.recharts-cartesian-axis-tick_text]:font-mono"
        >
          {chartType === "line" ? (
            <LineChart data={data} margin={{ left: 4, right: 12 }}>
              {axes}
              <Line
                dataKey="total"
                type="monotone"
                stroke="var(--color-total)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          ) : chartType === "bar" ? (
            <BarChart data={data} margin={{ left: 4, right: 12 }}>
              {axes}
              <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ left: 4, right: 12 }}>
              <defs>
                <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-total)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--color-total)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              {axes}
              <Area
                dataKey="total"
                type="monotone"
                fill="url(#fillTotal)"
                stroke="var(--color-total)"
                strokeWidth={2}
              />
            </AreaChart>
          )}
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
