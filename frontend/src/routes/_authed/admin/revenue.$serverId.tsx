import { useMemo } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeftIcon, WalletIcon } from "lucide-react"

import { RevenueTrendCard } from "@/components/dashboard/revenue-trend-card"
import { ServerRenewalHistoryTable } from "@/components/revenue/server-renewal-history-table"
import { ServerStatusBadge } from "@/components/common/server-status-badge"
import { StatCard } from "@/components/common/stat-card"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { costProfitMmk, formatMmk as mmk, formatUsd as usd } from "@/lib/format"
import {
  serverRenewalsQueryOptions,
  serversQueryOptions,
  useMmkPerUsd,
} from "@/lib/queries"
import type { RevenuePoint } from "@/lib/types"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_authed/admin/revenue/$serverId")({
  component: ServerRevenueDetailPage,
})

const monthLabel = (key: string) => {
  const [year, month] = key.split("-")
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(
    undefined,
    {
      month: "long",
      year: "numeric",
    }
  )
}

function payingKeysNote(server: {
  unpricedActiveKeys: number
  freeActiveKeys: number
}): string {
  if (server.unpricedActiveKeys > 0)
    return `${server.unpricedActiveKeys} unpriced`
  if (server.freeActiveKeys > 0) return `${server.freeActiveKeys} free`
  return "All priced"
}

/** One row per calendar month, taking that month's latest snapshot — revenue is a level, never summed. */
function monthlyBreakdown(series: RevenuePoint[]): RevenuePoint[] {
  const byMonth = new Map<string, RevenuePoint>()
  for (const p of series) byMonth.set(p.date.slice(0, 7), p)
  return [...byMonth.entries()]
    .map(([month, p]) => ({ ...p, date: month }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

function ServerRevenueDetailPage() {
  const { serverId } = Route.useParams()
  const { data: servers, isLoading } = useQuery(serversQueryOptions())
  const { data: renewals, isLoading: renewalsLoading } = useQuery(
    serverRenewalsQueryOptions(serverId)
  )
  const mmkPerUsd = useMmkPerUsd()

  const server = servers?.find((s) => s.id === serverId)
  const breakdown = useMemo(
    () => monthlyBreakdown(server?.revenueDailySeries ?? []),
    [server]
  )

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-16" />
        <div className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 md:h-32" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    )
  }

  if (!server) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          to="/admin/revenue"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Revenue
        </Link>
        <Empty className="rounded-lg border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WalletIcon />
            </EmptyMedia>
            <EmptyTitle>Server not found</EmptyTitle>
            <EmptyDescription>
              It may have been removed. Go back to Revenue and pick another
              server.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const { costMmk, profitMmk } = costProfitMmk(
    server.costUsdPerMonth,
    server.monthlyRevenueMmk,
    mmkPerUsd
  )
  const payingKeys = server.activeKeys - server.freeActiveKeys

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          to="/admin/revenue"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Revenue
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-heading text-2xl font-semibold">{server.name}</h1>
          <ServerStatusBadge status={server.health} />
        </div>
        <p className="text-sm text-muted-foreground">
          {server.hostname}
          {server.costUsdPerMonth !== null &&
            ` · $${server.costUsdPerMonth}/mo`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
        <StatCard
          label="Monthly revenue"
          value={mmk(server.monthlyRevenueMmk)}
          note={`${server.activeKeys} active key${server.activeKeys === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Monthly hosting cost"
          value={mmk(costMmk)}
          note={
            server.costUsdPerMonth === null
              ? "Not recorded"
              : usd(server.costUsdPerMonth)
          }
        />
        <StatCard
          label="Monthly profit"
          value={mmk(profitMmk)}
          note={
            profitMmk >= 0 ? "Revenue exceeds cost" : "Cost exceeds revenue"
          }
        />
        <StatCard
          label="Paying keys"
          value={`${payingKeys} / ${server.activeKeys}`}
          note={payingKeysNote(server)}
        />
      </div>

      <RevenueTrendCard
        servers={[server]}
        title={`${server.name} revenue trend`}
        description="Revenue, cost and profit for this server over time — one reading per cron tick."
      />

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">
            Monthly breakdown
          </CardTitle>
          <CardDescription>
            This server's revenue, cost and profit at the end of each month,
            newest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {breakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No revenue history yet — it builds up one reading per cron tick
              from here on.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Active keys</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.map((p) => {
                  const { costMmk: rowCostMmk, profitMmk: rowProfitMmk } =
                    costProfitMmk(p.costUsdPerMonth, p.revenueMmk, mmkPerUsd)
                  return (
                    <TableRow key={p.date}>
                      <TableCell>{monthLabel(p.date)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {p.activeKeys}
                        {p.unpricedActiveKeys > 0 && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {p.unpricedActiveKeys} unpriced
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {mmk(p.revenueMmk)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                        {p.costUsdPerMonth === null ? "—" : mmk(rowCostMmk)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono tabular-nums",
                          rowProfitMmk < 0 && "text-destructive"
                        )}
                      >
                        {mmk(rowProfitMmk)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ServerRenewalHistoryTable
        renewals={renewals}
        isLoading={renewalsLoading}
      />
    </div>
  )
}
