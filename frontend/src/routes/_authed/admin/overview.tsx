import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"

import { BandwidthConsumptionCard } from "@/components/dashboard/bandwidth-consumption-card"
import { CompareServersCard } from "@/components/dashboard/compare-servers-card"
import { FleetHealthCard } from "@/components/dashboard/fleet-health-card"
import { KeysAttentionCard } from "@/components/dashboard/keys-attention-card"
import { RetentionCard } from "@/components/dashboard/retention-card"
import { RevenueTrendCard } from "@/components/dashboard/revenue-trend-card"
import { StatCard } from "@/components/stat-card"
import { SyncPill } from "@/components/sync-pill"
import { Skeleton } from "@/components/ui/skeleton"
import { useIsUserActive } from "@/hooks/use-is-user-active"
import { formatBytesCompact } from "@/lib/format"
import {
  LIVE_REFRESH_MS,
  keysQueryOptions,
  retentionQueryOptions,
  serversQueryOptions,
  statsQueryOptions,
  useMmkPerUsd,
} from "@/lib/queries"

export const Route = createFileRoute("/_authed/admin/overview")({
  component: DashboardPage,
})

function connectedServersNote(degraded: number, offline: number): string {
  if (degraded > 0) {
    return `${degraded} degraded${offline > 0 ? `, ${offline} offline` : ""}`
  }
  if (offline > 0) return `${offline} offline`
  return "All healthy"
}

function bandwidthNote(totalServers: number, serversWithMetrics: number): string {
  if (totalServers === 0) return "No servers yet"
  if (serversWithMetrics === totalServers) {
    return `Across ${totalServers} server${totalServers === 1 ? "" : "s"}`
  }
  return `${serversWithMetrics} of ${totalServers} servers reporting live metrics`
}

function DashboardPage() {
  // Same idle-aware polling as the Servers page: every refresh fans out to
  // every Outline server, so an abandoned tab shouldn't keep hitting them.
  const isActive = useIsUserActive()
  const { data: servers, isLoading: serversLoading } = useQuery({
    ...serversQueryOptions(),
    refetchInterval: isActive ? LIVE_REFRESH_MS : false,
  })
  const { data: stats, isLoading: statsLoading } = useQuery(statsQueryOptions())
  const { data: keys, isLoading: keysLoading } = useQuery(keysQueryOptions())
  const { data: retention, isLoading: retentionLoading } = useQuery(retentionQueryOptions())
  const mmkPerUsd = useMmkPerUsd()

  const all = servers ?? []
  const statsLoaded = !statsLoading && stats !== undefined

  const lastSyncedAt = all
    .map((s) => s.lastSyncedAt)
    .filter((v): v is string => v !== null)
    .sort()
    .at(-1)

  const degraded = all.filter((s) => s.health === "degraded").length
  const offline = all.filter((s) => s.health === "offline").length
  const connected = all.length - offline

  const totalBandwidthBytes = all.reduce(
    (sum, s) => sum + (s.metrics?.totalBytes ?? 0),
    0,
  )
  const serversWithMetrics = all.filter((s) => s.metrics !== null).length

  const totalRevenueMmk = all.reduce((sum, s) => sum + s.monthlyRevenueMmk, 0)
  const totalCostMmk = all.reduce(
    (sum, s) => sum + (s.costUsdPerMonth ?? 0) * mmkPerUsd,
    0,
  )
  const totalProfitMmk = totalRevenueMmk - totalCostMmk
  const totalUnpriced = all.reduce((sum, s) => sum + s.unpricedActiveKeys, 0)
  const mmk = (n: number) => `${Math.round(n).toLocaleString("en-US")} MMK`

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Dashboard</p>
          <h1 className="font-heading text-2xl font-semibold">Overview</h1>
        </div>
        <SyncPill lastSyncedAt={lastSyncedAt} />
      </div>

      {serversLoading || !statsLoaded ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Active keys"
            value={String(stats.activeKeys)}
            note={`${stats.totalKeys} total · ${stats.expiredKeys} expired · ${stats.limitExceededKeys} over limit`}
          />
          <StatCard
            label="Connected servers"
            value={`${connected} / ${all.length}`}
            note={connectedServersNote(degraded, offline)}
          />
          <StatCard
            label="Bandwidth (30d)"
            value={formatBytesCompact(totalBandwidthBytes)}
            note={bandwidthNote(all.length, serversWithMetrics)}
          />
          <StatCard
            label="Monthly revenue"
            value={mmk(totalRevenueMmk)}
            note={
              totalUnpriced > 0
                ? `${totalUnpriced} unpriced key${totalUnpriced === 1 ? "" : "s"} — see Revenue`
                : "Every active key priced"
            }
          />
          <StatCard
            label="Monthly profit"
            value={mmk(totalProfitMmk)}
            note={totalProfitMmk >= 0 ? "Revenue exceeds cost" : "Cost exceeds revenue"}
          />
        </div>
      )}

      {serversLoading ? (
        <Skeleton className="h-80" />
      ) : (
        <BandwidthConsumptionCard servers={all} />
      )}
      {serversLoading ? (
        <Skeleton className="h-72" />
      ) : (
        <CompareServersCard servers={all} />
      )}
      {serversLoading ? (
        <Skeleton className="h-72" />
      ) : (
        <RevenueTrendCard servers={all} />
      )}

      <div className="grid items-stretch gap-4 lg:grid-cols-5">
        {keysLoading ? (
          <Skeleton className="h-64 lg:col-span-3" />
        ) : (
          <KeysAttentionCard keys={keys ?? []} className="lg:col-span-3" />
        )}
        {serversLoading ? (
          <Skeleton className="h-64 lg:col-span-2" />
        ) : (
          <FleetHealthCard servers={all} className="lg:col-span-2" />
        )}
      </div>

      {retentionLoading || !retention ? (
        <Skeleton className="h-72" />
      ) : (
        <RetentionCard metrics={retention} />
      )}
    </div>
  )
}
