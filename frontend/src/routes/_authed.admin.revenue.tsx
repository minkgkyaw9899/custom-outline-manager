import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { TriangleAlertIcon, WalletIcon } from "lucide-react"

import { RevenueTrendCard } from "@/components/dashboard/revenue-trend-card"
import { MMK_PER_USD } from "@/components/servers/add-server-dialog"
import { ServerStatusBadge } from "@/components/server-status-badge"
import { StatCard } from "@/components/stat-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { serversQueryOptions } from "@/lib/queries"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_authed/admin/revenue")({
  component: RevenuePage,
})

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" })

const mmk = (n: number) => `${Math.round(n).toLocaleString("en-US")} MMK`

function RevenuePage() {
  const { data: servers, isLoading } = useQuery(serversQueryOptions())

  const all = servers ?? []
  const costTracked = all.filter((s) => s.costUsdPerMonth !== null)
  const totalCostUsd = costTracked.reduce(
    (sum, s) => sum + (s.costUsdPerMonth ?? 0),
    0,
  )
  const totalCostMmk = totalCostUsd * MMK_PER_USD
  const totalRevenueMmk = all.reduce((sum, s) => sum + s.monthlyRevenueMmk, 0)
  const totalProfitMmk = totalRevenueMmk - totalCostMmk
  const totalActiveKeys = all.reduce((sum, s) => sum + s.activeKeys, 0)
  const totalUnpriced = all.reduce((sum, s) => sum + s.unpricedActiveKeys, 0)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">Dashboard / Revenue</p>
        <h1 className="font-heading text-2xl font-semibold">Revenue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Revenue is what each server's active keys are priced at (set per
          server, overridable per key — see a server's "Price per key" or a
          key's own "Price"). Cost is hosting expense entered separately in
          USD. Profit is revenue minus cost, both converted to MMK.
        </p>
      </div>

      {!isLoading && totalUnpriced > 0 && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>
            {totalUnpriced} active key{totalUnpriced === 1 ? "" : "s"} with no
            price set
          </AlertTitle>
          <AlertDescription>
            Counted as 0 MMK below — revenue and profit are understated until
            these are priced. Set a default price on their server, or price
            them individually from the keys table.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 md:h-32" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
          <StatCard
            label="Monthly revenue"
            value={mmk(totalRevenueMmk)}
            note={`${totalActiveKeys} active key${totalActiveKeys === 1 ? "" : "s"}`}
          />
          <StatCard
            label="Monthly hosting cost"
            value={mmk(totalCostMmk)}
            note={usd(totalCostUsd)}
          />
          <StatCard
            label="Monthly profit"
            value={mmk(totalProfitMmk)}
            note={
              totalProfitMmk >= 0 ? "Revenue exceeds cost" : "Cost exceeds revenue"
            }
          />
          <StatCard
            label="Servers cost-tracked"
            value={`${costTracked.length} / ${all.length}`}
            note={
              costTracked.length < all.length
                ? `${all.length - costTracked.length} without a recorded cost`
                : "All servers have a recorded cost"
            }
          />
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-72" />
      ) : (
        <RevenueTrendCard servers={all} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">
            Revenue and cost by server
          </CardTitle>
          <CardDescription>
            Revenue sums each active key's price (its own, or the server's
            default). Cost is the hosting expense entered on the server.
            Converted to MMK at the static rate of{" "}
            {MMK_PER_USD.toLocaleString("en-US")} MMK per $1.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : all.length === 0 ? (
            <Empty className="rounded-lg border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <WalletIcon />
                </EmptyMedia>
                <EmptyTitle>No servers yet</EmptyTitle>
                <EmptyDescription>
                  Add a server to start tracking its revenue and cost here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Server</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Active keys</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {all.map((server) => {
                  const costMmk = (server.costUsdPerMonth ?? 0) * MMK_PER_USD
                  const profitMmk = server.monthlyRevenueMmk - costMmk
                  return (
                    <TableRow key={server.id}>
                      <TableCell>
                        <Link
                          to="/admin/servers/$serverId"
                          params={{ serverId: server.id }}
                          className="font-medium hover:underline"
                        >
                          {server.name}
                        </Link>
                        {server.unpricedActiveKeys > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {server.unpricedActiveKeys} unpriced key
                            {server.unpricedActiveKeys === 1 ? "" : "s"}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <ServerStatusBadge status={server.health} />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {server.activeKeys}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {mmk(server.monthlyRevenueMmk)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {server.costUsdPerMonth === null ? "—" : mmk(costMmk)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono tabular-nums",
                          profitMmk < 0 && "text-destructive",
                        )}
                      >
                        {mmk(profitMmk)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {mmk(totalRevenueMmk)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {mmk(totalCostMmk)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono tabular-nums",
                      totalProfitMmk < 0 && "text-destructive",
                    )}
                  >
                    {mmk(totalProfitMmk)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
