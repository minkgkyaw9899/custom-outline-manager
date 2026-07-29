import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { KeysTable } from "@/components/keys/keys-table"
import { ServerStatusBadge } from "@/components/server-status-badge"
import { AsTable } from "@/components/servers/as-table"
import { AsUsageCharts } from "@/components/servers/as-usage-charts"
import { DailyTrafficCard } from "@/components/servers/daily-traffic-card"
import { EditServerDialog } from "@/components/servers/edit-server-dialog"
import { SyncPill } from "@/components/sync-pill"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { apiClient } from "@/lib/api"
import {
  formatBandwidth,
  formatBytesCompact,
  formatDate,
  formatHours,
} from "@/lib/format"
import { useIsUserActive } from "@/hooks/use-is-user-active"
import { isMockId, mockServerDetail } from "@/lib/mock-server-detail"
import { LIVE_REFRESH_MS, serverDetailQueryOptions } from "@/lib/queries"
import type { MetricsWindow } from "@/lib/types"
import { useState } from "react"

export const Route = createFileRoute("/_authed/admin/servers/$serverId")({
  component: ServerDetailPage,
})

const WINDOWS: { value: MetricsWindow; label: string }[] = [
  { value: "1d", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
]

/** Matches the bandwidth kill switch's own threshold: red once the cap is imminent, amber approaching it. */
function bandwidthProgressClass(usedRatio: number): string | undefined {
  if (usedRatio >= 0.9) return "**:data-[slot=progress-indicator]:bg-destructive"
  if (usedRatio >= 0.75) return "**:data-[slot=progress-indicator]:bg-warning"
  return undefined
}

function StatCard({
  label,
  value,
  note,
}: Readonly<{ label: string; value: string; note?: string }>) {
  return (
    <Card className="gap-1 py-3 md:gap-(--card-spacing) md:py-(--card-spacing)">
      <CardHeader className="gap-0.5 px-3 md:gap-1.5 md:px-(--card-spacing)">
        <CardDescription className="truncate text-[11px] md:text-sm">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-3 md:px-(--card-spacing)">
        <div className="truncate font-heading text-base font-bold tracking-tight md:text-3xl">
          {value}
        </div>
        {note && (
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground md:mt-1 md:text-sm">
            {note}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ServerDetailPage() {
  const { serverId } = Route.useParams()
  const [window, setWindow] = useState<MetricsWindow>("30d")
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // /servers/mock renders the design fixture: same components, no live server.
  const isMock = isMockId(serverId)

  const isActive = useIsUserActive()
  const { data, isLoading } = useQuery({
    ...serverDetailQueryOptions(serverId, window),
    ...(isMock ? { queryFn: mockServerDetail } : {}),
    refetchInterval: isActive && !isMock ? LIVE_REFRESH_MS : false,
  })

  const sync = useMutation({
    mutationFn: () => apiClient.post<{ status: string }>(`servers/${serverId}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      // A sync can change key links, usage or status — the user pages embed
      // that same key data and go stale otherwise.
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
  })

  const removeServer = useMutation({
    mutationFn: () => apiClient.delete<null>(`servers/${serverId}`),
    onSuccess: () => {
      setConfirmRemoveOpen(false)
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["stats"] })
      navigate({ to: "/admin/servers" })
    },
  })

  const reenableBandwidth = useMutation({
    mutationFn: () => apiClient.post(`servers/${serverId}/bandwidth/enable`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
  })

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-16" />
        <div className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 md:h-32" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  const { server, hostname, health, metrics, keys, keyMetrics, dailySeries } = data
  const windowLabel = WINDOWS.find((w) => w.value === window)?.label ?? window

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link
            to="/admin/servers"
            className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Servers
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-heading text-2xl font-semibold">{server.name}</h1>
            <ServerStatusBadge status={health} />
          </div>
          <p className="text-sm text-muted-foreground">
            {hostname}
            {server.costUsdPerMonth !== null && ` · $${server.costUsdPerMonth}/mo`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncPill lastSyncedAt={server.lastSyncedAt} />
          <Button
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            Sync now
          </Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Remove ${server.name}`}
            title="Remove server"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmRemoveOpen(true)}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      {server.lastSyncError && (
        <Alert variant="destructive">
          <AlertTitle>Last sync failed</AlertTitle>
          <AlertDescription>{server.lastSyncError}</AlertDescription>
        </Alert>
      )}

      {server.bandwidthDisabledAt && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Bandwidth limit reached — every key disabled</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              All keys on this server were automatically switched off to stop
              further transfer. Re-enable once the server has headroom again.
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => reenableBandwidth.mutate()}
              disabled={reenableBandwidth.isPending}
            >
              {reenableBandwidth.isPending && <Spinner data-icon="inline-start" />}
              Re-enable
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {data.server.bandwidthLimitBytes !== null && (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Bandwidth this month</span>
            <span className="font-mono tabular-nums">
              {formatBytesCompact(data.bandwidthUsedBytesThisMonth, { decimals: 1 })} /{" "}
              {formatBytesCompact(data.server.bandwidthLimitBytes, { decimals: 1 })}
            </span>
          </div>
          <Progress
            value={Math.min(
              100,
              (data.bandwidthUsedBytesThisMonth / data.server.bandwidthLimitBytes) * 100,
            )}
            aria-label="Bandwidth used this month"
            className={bandwidthProgressClass(
              data.bandwidthUsedBytesThisMonth / data.server.bandwidthLimitBytes,
            )}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-heading text-lg font-semibold">
          Server metrics · last {windowLabel}
        </h2>
        <ToggleGroup
          value={[window]}
          onValueChange={(v) => {
            if (v.length) setWindow(v[0] as MetricsWindow)
          }}
        >
          {WINDOWS.map((w) => (
            <ToggleGroupItem
              key={w.value}
              value={w.value}
              className="rounded-full border px-4 text-sm normal-case tracking-normal aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary"
            >
              {w.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {metrics === null ? (
        <Alert>
          <AlertTitle>Live metrics unavailable</AlertTitle>
          <AlertDescription>
            The Outline server could not be reached for a live read. Key counts and
            usage below come from the last successful sync.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/*
            Outline reports no inbound/outbound split — only a single transfer
            total — so these show the live rate and the window total instead.
          */}
          <div className="grid grid-cols-4 gap-2 md:grid-cols-2 md:gap-4 xl:grid-cols-4">
            <StatCard
              label="Total bandwidth usage"
              value={formatBytesCompact(metrics.totalBytes, { decimals: 2 })}
              note={`Last ${windowLabel}`}
            />
            <StatCard
              label="Current bandwidth usage"
              value={formatBandwidth(metrics.currentBandwidthBps)}
              note="Live rate"
            />
            <StatCard
              label="Peak bandwidth usage"
              value={formatBandwidth(metrics.peakBandwidthBps)}
              note={
                metrics.peakBandwidthAt ? formatDate(metrics.peakBandwidthAt) : undefined
              }
            />
            <StatCard
              label="Total tunnel time"
              value={formatHours(metrics.tunnelTimeHours)}
              note={`Last ${windowLabel}`}
            />
          </div>

        </>
      )}

      <DailyTrafficCard
        series={dailySeries}
        lifetimeBytes={keys.reduce((sum, k) => sum + k.usedBytes, 0)}
      />

      <KeysTable
        serverId={serverId}
        keys={keys}
        keyMetrics={keyMetrics}
        onlineKeys={metrics?.onlineKeys}
        windowLabel={windowLabel}
        defaultLimitBytes={data.server.defaultLimitBytes ?? null}
      />

      {metrics !== null && (
        <>
          <AsUsageCharts ases={metrics.ases} windowLabel={windowLabel} />
          <AsTable ases={metrics.ases} windowLabel={windowLabel} />
        </>
      )}

      <EditServerDialog
        serverId={serverId}
        detail={data}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <ConfirmDialog
        open={confirmRemoveOpen}
        onOpenChange={setConfirmRemoveOpen}
        title={`Remove ${server.name}?`}
        description={
          `This removes the server and its ${keys.length} key record${keys.length === 1 ? "" : "s"} ` +
          "from this dashboard, along with their usage history. The Outline server itself keeps running and " +
          "its access keys stay valid — re-add it any time with the same management key."
        }
        confirmLabel="Remove server"
        onConfirm={() => removeServer.mutate()}
        isPending={removeServer.isPending}
      />
    </div>
  )
}
