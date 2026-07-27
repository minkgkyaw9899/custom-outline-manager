import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowRightIcon, Trash2Icon } from "lucide-react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { ServerStatusBadge } from "@/components/server-status-badge"
import { AsShareList } from "@/components/servers/as-share-list"
import { UsageChart } from "@/components/servers/usage-chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { apiClient } from "@/lib/api"
import { formatBandwidth, formatBytesCompact, formatHours } from "@/lib/format"
import type { ServerWithUsage } from "@/lib/types"

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-heading text-xl font-bold tracking-tight">{value}</span>
    </div>
  )
}

export function ServerCard({ server }: Readonly<{ server: ServerWithUsage }>) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const queryClient = useQueryClient()
  const { metrics } = server

  const removeServer = useMutation({
    mutationFn: () => apiClient.delete<null>(`servers/${server.id}`),
    onSuccess: () => {
      setConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["stats"] })
    },
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        {/*
          Name and hostname are the same destination as Manage — the identity of
          a card is the most obvious thing to click, so it should not be inert.
        */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to="/admin/servers/$serverId"
              params={{ serverId: server.id }}
              className="font-heading text-lg font-semibold hover:underline"
            >
              {server.name}
            </Link>
            <ServerStatusBadge status={server.health} />
          </div>
          <Link
            to="/admin/servers/$serverId"
            params={{ serverId: server.id }}
            className="block truncate text-sm text-muted-foreground hover:text-foreground"
          >
            {server.hostname}
            {server.costUsdPerMonth !== null && ` · $${server.costUsdPerMonth}/mo`}
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`Remove ${server.name}`}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2Icon />
          </Button>
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/admin/servers/$serverId" params={{ serverId: server.id }} />}
            // Renders an <a>, not a <button>. Without this Base UI keeps native
            // button semantics on a non-button element and warns.
            nativeButton={false}
          >
            Manage
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/*
          Outline reports no inbound/outbound split, only a single transfer
          total, so bandwidth appears as a live rate plus the window total.
        */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Metric label="Total keys" value={String(server.keyCount)} />
          {/*
            Connected *now*, not the count of non-expired keys — the live figure
            is what an operator is actually looking for, and showing both side by
            side read as two versions of the same number.
          */}
          <Metric
            label="Connected keys"
            value={metrics ? String(metrics.onlineKeys) : "—"}
          />
          <Metric
            label="Peak devices"
            value={metrics ? String(metrics.peakDevicesTotal) : "—"}
          />
          <Metric
            label="Current bandwidth"
            value={metrics ? formatBandwidth(metrics.currentBandwidthBps) : "—"}
          />
          <Metric
            label="Total bandwidth"
            value={
              metrics
                ? formatBytesCompact(metrics.totalBytes, { decimals: 1 })
                : formatBytesCompact(server.totalUsedBytes, { decimals: 1 })
            }
          />
          <Metric
            label="Tunnel time"
            value={metrics ? formatHours(metrics.tunnelTimeHours) : "—"}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              ASes
            </span>
            <Badge variant="secondary">{metrics?.ases.length ?? 0}</Badge>
          </div>
          <AsShareList ases={metrics?.ases ?? []} limit={3} hideCaption />
        </div>

        <UsageChart series={server.dailySeries} />
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove ${server.name}?`}
        description={
          `This removes the server and its ${server.keyCount} key record${server.keyCount === 1 ? "" : "s"} ` +
          "from this dashboard, along with their usage history. The Outline server itself keeps running and " +
          "its access keys stay valid — re-add it any time with the same management key."
        }
        confirmLabel="Remove server"
        onConfirm={() => removeServer.mutate()}
        isPending={removeServer.isPending}
      />
    </Card>
  )
}
