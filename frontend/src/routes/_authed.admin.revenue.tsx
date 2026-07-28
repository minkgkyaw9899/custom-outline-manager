import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { WalletIcon } from "lucide-react"

import { MMK_PER_USD } from "@/components/servers/add-server-dialog"
import { ServerStatusBadge } from "@/components/server-status-badge"
import { StatCard } from "@/components/stat-card"
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

export const Route = createFileRoute("/_authed/admin/revenue")({
  component: RevenuePage,
})

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" })

const mmk = (n: number) => `${Math.round(n).toLocaleString("en-US")} MMK`

function RevenuePage() {
  const { data: servers, isLoading } = useQuery(serversQueryOptions())

  const all = servers ?? []
  const tracked = all.filter((s) => s.costUsdPerMonth !== null)
  const totalUsd = tracked.reduce((sum, s) => sum + (s.costUsdPerMonth ?? 0), 0)
  const totalActiveKeys = all.reduce((sum, s) => sum + s.activeKeys, 0)
  const costPerActiveKey = totalActiveKeys > 0 ? totalUsd / totalActiveKeys : 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">Dashboard / Revenue</p>
        <h1 className="font-heading text-2xl font-semibold">Revenue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This tracks hosting cost, not money collected from customers — there's
          no pricing or payment data in the system yet. Consider it the expense
          half of revenue until that exists.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 md:h-32" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
          <StatCard
            label="Monthly hosting cost"
            value={usd(totalUsd)}
            note={mmk(totalUsd * MMK_PER_USD)}
          />
          <StatCard
            label="Servers tracked"
            value={`${tracked.length} / ${all.length}`}
            note={
              tracked.length < all.length
                ? `${all.length - tracked.length} without a recorded cost`
                : "All servers have a recorded cost"
            }
          />
          <StatCard
            label="Active keys"
            value={String(totalActiveKeys)}
            note="Across every server"
          />
          <StatCard
            label="Cost per active key"
            value={totalActiveKeys > 0 ? usd(costPerActiveKey) : "—"}
            note={totalActiveKeys > 0 ? "Per month" : "No active keys yet"}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">
            Cost by server
          </CardTitle>
          <CardDescription>
            Monthly hosting cost as entered when each server was added or last
            edited. Converted to MMK at the static rate of{" "}
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
                  Add a server to start tracking its hosting cost here.
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
                  <TableHead className="text-right">Monthly cost</TableHead>
                  <TableHead className="text-right">In MMK</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {all.map((server) => (
                  <TableRow key={server.id}>
                    <TableCell>
                      <Link
                        to="/admin/servers/$serverId"
                        params={{ serverId: server.id }}
                        className="font-medium hover:underline"
                      >
                        {server.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <ServerStatusBadge status={server.health} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {server.activeKeys}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {server.costUsdPerMonth === null
                        ? "—"
                        : usd(server.costUsdPerMonth)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {server.costUsdPerMonth === null
                        ? "—"
                        : mmk(server.costUsdPerMonth * MMK_PER_USD)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {usd(totalUsd)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {mmk(totalUsd * MMK_PER_USD)}
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
