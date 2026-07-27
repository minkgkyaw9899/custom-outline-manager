import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis } from "recharts"

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
import { ChartLegendDot } from "@/components/dashboard/chart-legend-dot"
import { formatBytesCompact } from "@/lib/format"
import { DAY_LABELS, OVERVIEW_SERVERS, dailySeriesFor } from "@/lib/mock-dashboard"

type ChartType = "bar" | "line"

const CHART_TYPE_ITEMS = {
  bar: "Bar chart",
  line: "Line chart",
}

const SERVER_ITEMS = Object.fromEntries(
  OVERVIEW_SERVERS.map((s) => [s.id, s.name]),
)

function ServerSelect({
  value,
  onChange,
  label,
}: Readonly<{ value: string; onChange: (id: string) => void; label: string }>) {
  return (
    <Select
      items={SERVER_ITEMS}
      value={value}
      onValueChange={(v) => onChange(v as string)}
    >
      <SelectTrigger size="sm" aria-label={label}>
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
  )
}

export function CompareServersCard() {
  const [serverAId, setServerAId] = useState("singapore-02")
  const [serverBId, setServerBId] = useState("new-york-03")
  const [chartType, setChartType] = useState<ChartType>("bar")

  const serverA = OVERVIEW_SERVERS.find((s) => s.id === serverAId) ?? OVERVIEW_SERVERS[0]
  const serverB = OVERVIEW_SERVERS.find((s) => s.id === serverBId) ?? OVERVIEW_SERVERS[1]

  const chartConfig = {
    a: { label: serverA.name, color: "var(--chart-2)" },
    b: { label: serverB.name, color: "var(--chart-3)" },
  } satisfies ChartConfig

  const data = useMemo(() => {
    const seriesA = dailySeriesFor(serverAId)
    const seriesB = dailySeriesFor(serverBId)
    return DAY_LABELS.map((label, i) => ({ label, a: seriesA[i], b: seriesB[i] }))
  }, [serverAId, serverBId])

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
      <ChartTooltip
        content={
          <ChartTooltipContent
            formatter={(value, name) => (
              <span className="flex w-full items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor:
                      name === "a" ? "var(--color-a)" : "var(--color-b)",
                  }}
                />
                <span className="text-muted-foreground">
                  {name === "a" ? serverA.name : serverB.name}
                </span>
                <span className="ml-auto font-mono tabular-nums">
                  {formatBytesCompact(Number(value))}
                </span>
              </span>
            )}
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
          <CardTitle className="font-heading text-lg">Compare server bandwidth</CardTitle>
          <CardDescription>
            {serverA.name} vs {serverB.name} · total bandwidth per period
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-4">
            <ChartLegendDot color="var(--chart-2)" label={serverA.name} />
            <ChartLegendDot color="var(--chart-3)" label={serverB.name} />
          </div>
          <div className="flex items-center gap-2">
            <ServerSelect value={serverAId} onChange={setServerAId} label="First server" />
            <span className="text-xs text-muted-foreground">vs</span>
            <ServerSelect value={serverBId} onChange={setServerBId} label="Second server" />
          </div>
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
        <ChartContainer
          config={chartConfig}
          className="h-72 w-full [&_.recharts-cartesian-axis-tick_text]:font-mono"
        >
          {chartType === "bar" ? (
            <BarChart data={data} margin={{ left: 12, right: 12 }} barGap={2}>
              {axes}
              <Bar dataKey="a" fill="var(--color-a)" radius={[3, 3, 3, 3]} maxBarSize={12} />
              <Bar dataKey="b" fill="var(--color-b)" radius={[3, 3, 3, 3]} maxBarSize={12} />
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ left: 12, right: 12 }}>
              {axes}
              <Line
                dataKey="a"
                type="monotone"
                stroke="var(--color-a)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                dataKey="b"
                type="monotone"
                stroke="var(--color-b)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          )}
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
