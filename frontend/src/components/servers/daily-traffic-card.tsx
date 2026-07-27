import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UsageChart } from "@/components/servers/usage-chart"
import type { DailyUsage, UsageGranularity } from "@/lib/types"

/**
 * Wraps UsageChart in a card of its own, shared by the server and key detail
 * pages. Servers are always day-bucketed; a key under a day old switches to
 * hour buckets (see UsageGranularity), in which case the card relabels itself
 * accordingly rather than showing an empty "Daily traffic" chart.
 */
export function DailyTrafficCard({
  series,
  granularity = "day",
  days = 14,
}: Readonly<{ series: DailyUsage[]; granularity?: UsageGranularity; days?: number }>) {
  const isHourly = granularity === "hour"
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">
          {isHourly ? "Hourly traffic" : "Daily traffic"}
        </CardTitle>
        <CardDescription>
          {isHourly
            ? "Measured from sync history, last 24 hours"
            : `Measured from sync history, last ${days} days`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UsageChart series={series} granularity={granularity} className="h-56 w-full" />
      </CardContent>
    </Card>
  )
}
