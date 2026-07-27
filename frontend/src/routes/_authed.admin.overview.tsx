import { createFileRoute } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { BandwidthConsumptionCard } from "@/components/dashboard/bandwidth-consumption-card"
import { CompareServersCard } from "@/components/dashboard/compare-servers-card"
import { FleetHealthCard } from "@/components/dashboard/fleet-health-card"
import { KeysAttentionCard } from "@/components/dashboard/keys-attention-card"
import { StatCard } from "@/components/dashboard/stat-card"
import { LAST_SYNC_SECONDS_AGO, OVERVIEW_STATS } from "@/lib/mock-dashboard"

export const Route = createFileRoute("/_authed/admin/overview")({
  component: DashboardPage,
})

function DashboardPage() {
  const { keys, servers, bandwidth } = OVERVIEW_STATS

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Dashboard</p>
          <h1 className="font-heading text-2xl font-semibold">Overview</h1>
        </div>
        <Button
          variant="outline"
          className="rounded-full border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
        >
          <span
            aria-hidden
            data-icon="inline-start"
            className="size-2 animate-pulse rounded-full bg-primary"
          />
          Sync {LAST_SYNC_SECONDS_AGO}s ago
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Total active keys"
          badge={`+${keys.deltaThisWeek} this week`}
          badgeTone="positive"
          value={String(keys.total)}
          valueSuffix="keys"
          note={`${keys.expiringIn7Days} expiring in 7 days`}
          sparkline={keys.spark}
        />
        <StatCard
          label="Connected servers"
          badge={`${servers.degraded} degraded`}
          badgeTone="warning"
          value={String(servers.connected)}
          valueSuffix={`of ${servers.total}`}
          note={servers.note}
          sparkline={servers.spark}
        />
        <StatCard
          label="Aggregate bandwidth"
          badge={`+${bandwidth.deltaPct}%`}
          badgeTone="positive"
          value={(bandwidth.monthlyBytes / 1e12).toFixed(1)}
          valueSuffix="TB / mo"
          note={`In ${(bandwidth.inBytes / 1e12).toFixed(1)} TB · Out ${(bandwidth.outBytes / 1e12).toFixed(1)} TB`}
          sparkline={bandwidth.spark}
        />
      </div>

      <BandwidthConsumptionCard />
      <CompareServersCard />

      <div className="grid items-stretch gap-4 lg:grid-cols-5">
        <KeysAttentionCard className="lg:col-span-3" />
        <FleetHealthCard className="lg:col-span-2" />
      </div>
    </div>
  )
}
