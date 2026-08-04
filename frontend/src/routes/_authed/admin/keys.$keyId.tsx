import { useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { DynamicLinkRecommendedBadge } from "@/components/keys/dynamic-link-info-dialog"
import { EditKeyDialog } from "@/components/keys/edit-key-dialog"
import {
  KeyConnectionStatus,
  keyAccessUrlWithName,
  keyDisplayName,
} from "@/components/keys/key-connection-status"
import { KeyLimitHistoryChart } from "@/components/keys/key-limit-history-chart"
import { KeyLinkField } from "@/components/keys/key-link-field"
import { KeyUsageDonut } from "@/components/keys/key-usage-donut"
import { DailyTrafficCard } from "@/components/servers/daily-traffic-card"
import { DetailRow } from "@/components/common/detail-row"
import { StatCard } from "@/components/common/stat-card"
import { StatusBadge } from "@/components/common/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useIsUserActive } from "@/hooks/use-is-user-active"
import { apiClient } from "@/lib/api"
import {
  formatBytesCompact,
  formatDate,
  formatDateOnly,
  formatDaysLeft,
  formatHours,
  formatRelativeTime,
  formatUsagePair,
  usageBarColor,
} from "@/lib/format"
import {
  isMockId,
  mockDeleteKey,
  mockKeyDaily,
  mockServerDetail,
} from "@/lib/mock-server-detail"
import {
  keyDailyQueryOptions,
  keyDetailQueryOptions,
  keyRenewalsQueryOptions,
  LIVE_REFRESH_MS,
  serverDetailQueryOptions,
} from "@/lib/queries"
import type { Key, KeyMetrics, RenewalLog } from "@/lib/types"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_authed/admin/keys/$keyId")({
  component: KeyDetailPage,
})

function UsageBar({ keyItem }: Readonly<{ keyItem: Key }>) {
  if (keyItem.customLimitBytes === null) {
    return (
      <p className="text-sm text-muted-foreground">
        No data limit set on this key.
      </p>
    )
  }
  const ratio =
    keyItem.customLimitBytes === 0
      ? 1
      : keyItem.usedBytes / keyItem.customLimitBytes
  return (
    <div className="flex flex-col gap-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", usageBarColor(ratio))}
          style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
        />
      </div>
      <div className="flex justify-between text-sm text-muted-foreground">
        <span className="font-mono tabular-nums">
          {formatUsagePair(keyItem.usedBytes, keyItem.customLimitBytes)}
        </span>
        <span className="tabular-nums">{Math.round(ratio * 100)}% used</span>
      </div>
    </div>
  )
}

/** The four headline stat cards at the top of the key detail page. */
function KeyStatsGrid({
  keyItem,
  metrics,
}: Readonly<{ keyItem: Key; metrics: KeyMetrics | undefined }>) {
  const remainingNote =
    keyItem.remainingBytes === null
      ? "No limit"
      : `${formatBytesCompact(keyItem.remainingBytes, { decimals: 1 })} remaining`
  const lastActiveNote = metrics?.isOnline ? "Connected now" : undefined

  return (
    <div className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
      <StatCard
        label="Data usage"
        value={formatUsagePair(keyItem.usedBytes, keyItem.customLimitBytes)}
        note={remainingNote}
      />
      <StatCard
        label="Tunnel time"
        value={metrics ? formatHours(metrics.tunnelTimeHours) : "—"}
        note="Last 30 days"
      />
      <StatCard
        label="Peak devices"
        value={metrics ? String(metrics.peakDeviceCount) : "—"}
        note="Most seen at once"
      />
      <StatCard
        label="Last active"
        value={metrics ? formatRelativeTime(metrics.lastTrafficSeen) : "—"}
        note={lastActiveNote}
      />
    </div>
  )
}

function RenewalHistory({
  keyId,
  renewals,
  isLoading,
}: Readonly<{
  keyId: string
  renewals: RenewalLog[] | undefined
  isLoading: boolean
}>) {
  const queryClient = useQueryClient()
  const togglePaid = useMutation({
    mutationFn: (renewal: RenewalLog) =>
      apiClient.patch(`keys/${keyId}/renewals/${renewal.id}/payment`, {
        paid: !renewal.paid,
        note: renewal.paymentNote ?? "",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: keyRenewalsQueryOptions(keyId).queryKey,
      })
    },
  })

  let content: React.ReactNode
  if (isLoading) {
    content = <Skeleton className="h-24" />
  } else if (!renewals || renewals.length === 0) {
    content = (
      <p className="text-sm text-muted-foreground">
        This key has not been renewed since it was created.
      </p>
    )
  } else {
    content = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Applied</TableHead>
            <TableHead className="text-right">Added data</TableHead>
            <TableHead className="text-right">Added days</TableHead>
            <TableHead className="text-right">New limit</TableHead>
            <TableHead className="text-right">New expiry</TableHead>
            <TableHead>Payment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {renewals.map((renewal) => {
            // Nothing was added: the limit and expiry were written
            // directly ("Set exact"), so the two added columns would read
            // as a renewal that granted nothing.
            const manual = renewal.addedGb === 0 && renewal.addedDays === 0
            return (
              <TableRow key={renewal.id}>
                <TableCell>
                  {formatDate(renewal.createdAt)}
                  {manual && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      set manually
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {manual ? "—" : `${renewal.addedGb} GB`}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {manual ? "—" : renewal.addedDays}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatBytesCompact(renewal.newLimitBytes, {
                    decimals: 1,
                  })}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatDateOnly(renewal.newEndDate)}
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    title={renewal.paymentNote ?? undefined}
                    disabled={togglePaid.isPending}
                    onClick={() => togglePaid.mutate(renewal)}
                  >
                    <Badge variant={renewal.paid ? "secondary" : "destructive"}>
                      {renewal.paid ? "Paid" : "Unpaid"}
                    </Badge>
                  </button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Renewal history</CardTitle>
        <CardDescription>
          Every top-up applied to this key, newest first. Click a payment badge
          to correct it.
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}

function KeyDetailPage() {
  const { keyId } = Route.useParams()
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Keys of the /servers/mock fixture resolve out of the same in-memory store,
  // so the detail screen is reviewable without a live Outline server.
  const isMock = isMockId(keyId)
  const isActive = useIsUserActive()

  const {
    data: keyItem,
    isLoading,
    isError,
  } = useQuery({
    ...keyDetailQueryOptions(keyId),
    ...(isMock
      ? {
          queryFn: async () => {
            const detail = await mockServerDetail()
            const found = detail.keys.find((k) => k.id === keyId)
            if (!found) throw new Error("Key not found")
            return found
          },
        }
      : {}),
  })

  // The per-key live figures (tunnel time, peak devices, connected now) only
  // exist on the server's metrics read — there is no per-key metrics endpoint.
  const { data: serverDetail } = useQuery({
    ...serverDetailQueryOptions(keyItem?.serverId ?? ""),
    ...(isMock ? { queryFn: mockServerDetail } : {}),
    enabled: keyItem !== undefined,
    refetchInterval: isActive && !isMock ? LIVE_REFRESH_MS : false,
  })

  const { data: renewals, isLoading: renewalsLoading } = useQuery({
    ...keyRenewalsQueryOptions(keyId),
    ...(isMock ? { queryFn: async () => [] as RenewalLog[] } : {}),
  })

  const { data: usageSeries } = useQuery({
    ...keyDailyQueryOptions(keyId),
    ...(isMock ? { queryFn: () => mockKeyDaily(keyId) } : {}),
  })

  // Resyncs just this key's server — same endpoint as the server detail
  // page's "Sync now", scoped here so a stale usage/limit figure on this one
  // key can be refreshed without leaving the page.
  const sync = useMutation({
    mutationFn: (serverId: string) =>
      apiClient.post<{ status: string }>(`servers/${serverId}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      // A sync can change this key's link, usage or status — the user pages
      // embed that same key data and go stale otherwise.
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
  })

  const removeKey = useMutation({
    mutationFn: () =>
      isMock ? mockDeleteKey(keyId) : apiClient.delete<null>(`keys/${keyId}`),
    onSuccess: () => {
      setConfirmDeleteOpen(false)
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      queryClient.invalidateQueries({ queryKey: ["stats"] })
      queryClient.invalidateQueries({ queryKey: ["users"] })
      navigate({
        to: "/admin/servers/$serverId",
        params: { serverId: keyItem?.serverId ?? "" },
      })
    },
  })

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Key not found</AlertTitle>
        <AlertDescription>
          This key no longer exists, or it was removed from the dashboard.{" "}
          <Link to="/admin/servers" className="underline">
            Back to servers
          </Link>
        </AlertDescription>
      </Alert>
    )
  }

  if (isLoading || !keyItem) {
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

  const metrics = serverDetail?.keyMetrics?.[keyItem.outlineKeyId]
  const serverName = serverDetail?.server.name ?? "Server"
  const displayName = keyDisplayName(keyItem)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            to="/admin/servers/$serverId"
            params={{ serverId: keyItem.serverId }}
            className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            {serverName}
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <KeyConnectionStatus
              name={keyItem.name}
              outlineKeyId={keyItem.outlineKeyId}
              isOnline={metrics?.isOnline ?? false}
              className="font-heading text-2xl font-semibold"
            />
            <StatusBadge status={keyItem.status} />
            {!keyItem.enabled && <Badge variant="outline">Switched off</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Outline key {keyItem.outlineKeyId} · created{" "}
            {formatDateOnly(keyItem.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sharing and the holder-facing status page live on the user, not
              here — a key is now an implementation detail behind a person. */}
          {keyItem.userId && (
            <Button
              variant="outline"
              render={
                <Link
                  to="/admin/users/$userId"
                  params={{ userId: keyItem.userId }}
                />
              }
            >
              <UserIcon data-icon="inline-start" />
              {keyItem.userName || "Holder"}
            </Button>
          )}
          {!isMock && (
            <Button
              variant="outline"
              onClick={() => sync.mutate(keyItem.serverId)}
              disabled={sync.isPending}
            >
              {sync.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              Sync
            </Button>
          )}
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Delete ${displayName}`}
            title="Delete key"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      {serverDetail?.metrics === null && (
        <Alert>
          <AlertTitle>Live metrics unavailable</AlertTitle>
          <AlertDescription>
            The Outline server could not be reached, so tunnel time, peak
            devices and connection state are missing. Usage and quota below come
            from the last successful sync.
          </AlertDescription>
        </Alert>
      )}

      <KeyStatsGrid keyItem={keyItem} metrics={metrics} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Plan</CardTitle>
            <CardDescription>
              Quota and expiry as of the last sync with the Outline server.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <UsageBar keyItem={keyItem} />
            <dl className="flex flex-col">
              <DetailRow label="Data used">
                <span className="font-mono tabular-nums">
                  {formatBytesCompact(keyItem.usedBytes, { decimals: 1 })}
                </span>
              </DetailRow>
              <DetailRow label="Data limit">
                <span className="font-mono tabular-nums">
                  {keyItem.customLimitBytes === null
                    ? "No limit"
                    : formatBytesCompact(keyItem.customLimitBytes, {
                        decimals: 1,
                      })}
                </span>
              </DetailRow>
              <DetailRow label="Remaining">
                <span className="font-mono tabular-nums">
                  {keyItem.remainingBytes === null
                    ? "—"
                    : formatBytesCompact(keyItem.remainingBytes, {
                        decimals: 1,
                      })}
                </span>
              </DetailRow>
              <DetailRow label="Expires">
                <span className="font-mono tabular-nums">
                  {formatDateOnly(keyItem.endDate)}
                </span>
              </DetailRow>
              <DetailRow label="Time left">
                {formatDaysLeft(keyItem.daysLeft)}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Connection</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <KeyLinkField
              label="Dynamic key"
              value={keyItem.dynamicAccessUrl}
              emptyNote="Not configured for this server — set a dynamic link host from the server's Edit menu."
              badge={
                keyItem.dynamicAccessUrl ? (
                  <DynamicLinkRecommendedBadge />
                ) : undefined
              }
            />
            <KeyLinkField
              label="Static key"
              value={keyAccessUrlWithName(keyItem)}
            />
            <dl className="flex flex-col">
              <DetailRow label="Server">
                <Link
                  to="/admin/servers/$serverId"
                  params={{ serverId: keyItem.serverId }}
                  className="underline underline-offset-2"
                >
                  {serverName}
                </Link>
              </DetailRow>
              <DetailRow label="Host">
                <span className="font-mono text-xs">
                  {serverDetail?.accessKeyHostname || "—"}
                </span>
              </DetailRow>
              <DetailRow label="Port">
                <span className="font-mono tabular-nums">
                  {keyItem.port ?? "—"}
                </span>
              </DetailRow>
              <DetailRow label="Cipher">
                <span className="font-mono text-xs">
                  {keyItem.method ?? "—"}
                </span>
              </DetailRow>
              <DetailRow label="Outline key id">
                <span className="font-mono tabular-nums">
                  {keyItem.outlineKeyId}
                </span>
              </DetailRow>
              <DetailRow label="Created">
                {formatDate(keyItem.createdAt)}
              </DetailRow>
              <DetailRow label="Last updated">
                {formatDate(keyItem.updatedAt)}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DailyTrafficCard
          series={usageSeries?.series ?? []}
          granularity={usageSeries?.granularity}
          lifetimeBytes={keyItem.usedBytes}
        />
        <KeyUsageDonut keyItem={keyItem} />
      </div>

      <KeyLimitHistoryChart renewals={renewals ?? []} />

      <RenewalHistory
        keyId={keyId}
        renewals={renewals}
        isLoading={renewalsLoading}
      />

      <EditKeyDialog
        keyItem={keyItem}
        defaultLimitBytes={serverDetail?.server.defaultLimitBytes ?? null}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete ${displayName}?`}
        description={
          "The key is removed from the Outline server immediately and its holder loses access. " +
          "Usage history for it is deleted too. This cannot be undone."
        }
        confirmLabel="Delete key"
        onConfirm={() => removeKey.mutate()}
        isPending={removeKey.isPending}
      />
    </div>
  )
}
