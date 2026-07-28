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
import type { ServerWithUsage } from "@/lib/types"

type ChartType = "bar" | "line"

const CHART_TYPE_ITEMS = {
  bar: "Bar chart",
  line: "Line chart",
}

function shortDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

function ServerSelect({
  servers,
  value,
  onChange,
  label,
}: Readonly<{
  servers: ServerWithUsage[]
  value: string
  onChange: (id: string) => void
  label: string
}>) {
  const items = Object.fromEntries(servers.map((s) => [s.id, s.name]))
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(v as string)}>
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {servers.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function CompareServersCard({
  servers,
}: Readonly<{ servers: ServerWithUsage[] }>) {
  const [serverAId, setServerAId] = useState(servers[0]?.id ?? "")
  const [serverBId, setServerBId] = useState(servers[1]?.id ?? servers[0]?.id ?? "")
  const [chartType, setChartType] = useState<ChartType>("bar")

  const serverA = servers.find((s) => s.id === serverAId) ?? servers[0]
  const serverB = servers.find((s) => s.id === serverBId) ?? servers[1] ?? servers[0]

  const chartConfig = {
    a: { label: serverA?.name ?? "A", color: "var(--chart-2)" },
    b: { label: serverB?.name ?? "B", color: "var(--chart-3)" },
  } satisfies ChartConfig

  const data = useMemo(() => {
    if (!serverA || !serverB) return []
    const aMap = new Map(serverA.dailySeries.map((d) => [d.date, d.bytes]))
    const bMap = new Map(serverB.dailySeries.map((d) => [d.date, d.bytes]))
    const dates = Array.from(
      new Set([...aMap.keys(), ...bMap.keys()]),
    ).sort()
    return dates.map((date) => ({
      label: shortDate(date),
      a: aMap.get(date) ?? 0,
      b: bMap.get(date) ?? 0,
    }))
  }, [serverA, serverB])

  if (!serverA || !serverB) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Compare server bandwidth</CardTitle>
          <CardDescription>Add at least one server to compare.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

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
            {serverA.name} vs {serverB.name} · total bandwidth per day
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-4">
            <ChartLegendDot color="var(--chart-2)" label={serverA.name} />
            <ChartLegendDot color="var(--chart-3)" label={serverB.name} />
          </div>
          <div className="flex items-center gap-2">
            <ServerSelect servers={servers} value={serverAId} onChange={setServerAId} label="First server" />
            <span className="text-xs text-muted-foreground">vs</span>
            <ServerSelect servers={servers} value={serverBId} onChange={setServerBId} label="Second server" />
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
        {data.length === 0 ? (
          <p className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            No traffic history yet — the daily sync needs at least two days of
            snapshots.
          </p>
        ) : (
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
        )}
      </CardContent>
    </Card>
  )
}
