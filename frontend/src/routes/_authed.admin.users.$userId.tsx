import { useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  LinkIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DetailRow } from "@/components/detail-row"
import { EditKeyDialog } from "@/components/keys/edit-key-dialog"
import {
  KeyConnectionStatus,
  keyAccessUrlWithName,
} from "@/components/keys/key-connection-status"
import { KeyLimitHistoryChart } from "@/components/keys/key-limit-history-chart"
import { KeyLinkField } from "@/components/keys/key-link-field"
import { KeyUsageDonut } from "@/components/keys/key-usage-donut"
import { DailyTrafficCard } from "@/components/servers/daily-traffic-card"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import { ChangeKeyDialog } from "@/components/users/change-key-dialog"
import { EditUserDialog } from "@/components/users/edit-user-dialog"
import { UserShareDialog } from "@/components/users/user-share-dialog"
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
} from "@/lib/format"
import {
  keyDailyQueryOptions,
  keyRenewalsQueryOptions,
  LIVE_REFRESH_MS,
  serverDetailQueryOptions,
  userDetailQueryOptions,
} from "@/lib/queries"
import type { Key, UserWithKeys } from "@/lib/types"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_authed/admin/users/$userId")({
  component: UserDetailPage,
})

/** Matches the users table: green until three quarters spent, red at the cap. */
function usageBarColor(ratio: number): string {
  if (ratio >= 1) return "bg-destructive"
  if (ratio >= 0.75) return "bg-chart-3"
  return "bg-chart-1"
}

function UsageBar({ keyItem }: Readonly<{ keyItem: Key }>) {
  if (keyItem.customLimitBytes === null) {
    return (
      <p className="text-sm text-muted-foreground">
        No data limit set on this key.
      </p>
    )
  }
  const ratio =
    keyItem.customLimitBytes === 0 ? 1 : keyItem.usedBytes / keyItem.customLimitBytes
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

/**
 * The holder's other keys, if they have any. A user's link resolves through
 * exactly one key, so the rest are listed here with the ability to promote one
 * — which is the no-new-key way of changing what their link points at.
 */
function OtherKeysCard({ user }: Readonly<{ user: UserWithKeys }>) {
  const queryClient = useQueryClient()
  const others = user.keys.filter((k) => k.id !== user.primaryKeyId)

  const promote = useMutation({
    mutationFn: (keyId: string) =>
      apiClient.patch<UserWithKeys>(`users/${user.id}/primary-key`, { keyId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  })

  const unlink = useMutation({
    mutationFn: (keyId: string) =>
      apiClient.delete<null>(`users/${user.id}/keys/${keyId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
    },
  })

  if (others.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Other keys</CardTitle>
        <CardDescription>
          Also held by {user.name}, but not what their link resolves to. Make
          one active to switch them over without issuing a new link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Server</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Usage</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {others.map((key) => (
              <TableRow key={key.id}>
                <TableCell>
                  <Link
                    to="/admin/keys/$keyId"
                    params={{ keyId: key.id }}
                    className="hover:underline"
                  >
                    {key.name || key.outlineKeyId}
                  </Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {key.serverName ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={key.status} />
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {formatUsagePair(key.usedBytes, key.customLimitBytes)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={promote.isPending}
                      onClick={() => promote.mutate(key.id)}
                    >
                      Make active
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Unlink ${key.name || key.outlineKeyId}`}
                      title="Unlink from this user"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={unlink.isPending}
                      onClick={() => unlink.mutate(key.id)}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function UserDetailPage() {
  const { userId } = Route.useParams()
  const [editOpen, setEditOpen] = useState(false)
  const [editKeyOpen, setEditKeyOpen] = useState(false)
  const [changeKeyOpen, setChangeKeyOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isActive = useIsUserActive()

  const { data: user, isLoading, isError } = useQuery(userDetailQueryOptions(userId))
  const key = user?.primaryKey ?? null

  // The per-key live figures (tunnel time, peak devices, connected now) only
  // exist on the server's metrics read — there is no per-key metrics endpoint.
  const { data: serverDetail } = useQuery({
    ...serverDetailQueryOptions(key?.serverId ?? ""),
    enabled: !!key,
    refetchInterval: isActive ? LIVE_REFRESH_MS : false,
  })

  const { data: usageSeries } = useQuery({
    ...keyDailyQueryOptions(key?.id ?? ""),
    enabled: !!key,
  })

  const { data: renewals } = useQuery({
    ...keyRenewalsQueryOptions(key?.id ?? ""),
    enabled: !!key,
  })

  const removeUser = useMutation({
    mutationFn: () => apiClient.delete<null>(`users/${userId}`),
    onSuccess: () => {
      setConfirmDeleteOpen(false)
      queryClient.invalidateQueries({ queryKey: ["users"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      navigate({ to: "/admin/users" })
    },
  })

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>User not found</AlertTitle>
        <AlertDescription>
          This user no longer exists.{" "}
          <Link to="/admin/users" className="underline">
            Back to users
          </Link>
        </AlertDescription>
      </Alert>
    )
  }

  if (isLoading || !user) {
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

  const metrics = key ? serverDetail?.keyMetrics?.[key.outlineKeyId] : undefined

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            to="/admin/users"
            className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Users
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <KeyConnectionStatus
              name={user.name}
              outlineKeyId={key?.outlineKeyId ?? ""}
              isOnline={metrics?.isOnline ?? false}
              className="font-heading text-2xl font-semibold"
            />
            {key ? (
              <StatusBadge status={key.status} />
            ) : (
              <Badge variant="outline">No key</Badge>
            )}
            {user.status === "inactive" && (
              <Badge variant="outline">Inactive holder</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {user.keyCount} key{user.keyCount === 1 ? "" : "s"} · joined{" "}
            {formatDateOnly(user.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
          <Button variant="outline" onClick={() => setChangeKeyOpen(true)}>
            <RefreshCwIcon data-icon="inline-start" />
            Change key
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Share ${user.name}`}
            title="Share view link"
            onClick={() => setShareOpen(true)}
          >
            <LinkIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Delete ${user.name}`}
            title="Delete user"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      {user.note && (
        <Alert>
          <AlertTitle>Note</AlertTitle>
          <AlertDescription>{user.note}</AlertDescription>
        </Alert>
      )}

      {!key && (
        <Alert>
          <AlertTitle>No access key</AlertTitle>
          <AlertDescription>
            {user.name} has a share link, but it resolves to nothing until they
            are given a key. Use "Change key" to create one on a server.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
        <StatCard
          label="Data usage"
          value={
            key ? formatUsagePair(key.usedBytes, key.customLimitBytes) : "—"
          }
          note={
            key?.remainingBytes === null || key === null
              ? "No limit"
              : `${formatBytesCompact(key.remainingBytes, { decimals: 1 })} remaining`
          }
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
          note={metrics?.isOnline ? "Connected now" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="font-heading text-lg">Plan</CardTitle>
              <CardDescription>
                Quota and expiry as of the last sync with the Outline server.
              </CardDescription>
            </div>
            {key && (
              <Button variant="outline" size="sm" onClick={() => setEditKeyOpen(true)}>
                Extend or set
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {key ? (
              <>
                <UsageBar keyItem={key} />
                <dl className="flex flex-col">
                  <DetailRow label="Data used">
                    <span className="font-mono tabular-nums">
                      {formatBytesCompact(key.usedBytes, { decimals: 1 })}
                    </span>
                  </DetailRow>
                  <DetailRow label="Data limit">
                    <span className="font-mono tabular-nums">
                      {key.customLimitBytes === null
                        ? "No limit"
                        : formatBytesCompact(key.customLimitBytes, { decimals: 1 })}
                    </span>
                  </DetailRow>
                  <DetailRow label="Remaining">
                    <span className="font-mono tabular-nums">
                      {key.remainingBytes === null
                        ? "—"
                        : formatBytesCompact(key.remainingBytes, { decimals: 1 })}
                    </span>
                  </DetailRow>
                  <DetailRow label="Expires">
                    <span className="font-mono tabular-nums">
                      {formatDateOnly(key.endDate)}
                    </span>
                  </DetailRow>
                  <DetailRow label="Time left">
                    {formatDaysLeft(key.daysLeft)}
                  </DetailRow>
                </dl>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing to show until this holder has a key.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Connection</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <KeyLinkField
              label="Dynamic key (share this)"
              value={user.dynamicAccessUrl}
              emptyNote="Not configured for this deployment — set PUBLIC_BASE_URL on the backend to hand out dynamic links."
            />
            {key && (
              <KeyLinkField label="Static key" value={keyAccessUrlWithName(key)} />
            )}
            <dl className="flex flex-col">
              <DetailRow label="Server">
                {key ? (
                  <Link
                    to="/admin/servers/$serverId"
                    params={{ serverId: key.serverId }}
                    className="underline underline-offset-2"
                  >
                    {key.serverName ?? serverDetail?.server.name ?? "Server"}
                  </Link>
                ) : (
                  "—"
                )}
              </DetailRow>
              <DetailRow label="Host">
                <span className="font-mono text-xs">
                  {serverDetail?.hostname ?? "—"}
                </span>
              </DetailRow>
              <DetailRow label="Key">
                {key ? (
                  <Link
                    to="/admin/keys/$keyId"
                    params={{ keyId: key.id }}
                    className="underline underline-offset-2"
                  >
                    {key.name || key.outlineKeyId}
                  </Link>
                ) : (
                  "—"
                )}
              </DetailRow>
              <DetailRow label="Keys held">{user.keyCount}</DetailRow>
              <DetailRow label="Last updated">{formatDate(user.updatedAt)}</DetailRow>
            </dl>
          </CardContent>
        </Card>
      </div>

      {key && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <DailyTrafficCard
              series={usageSeries?.series ?? []}
              granularity={usageSeries?.granularity}
            />
            <KeyUsageDonut keyItem={key} />
          </div>

          <KeyLimitHistoryChart renewals={renewals ?? []} />
        </>
      )}

      <OtherKeysCard user={user} />

      <EditUserDialog user={user} open={editOpen} onOpenChange={setEditOpen} />

      <EditKeyDialog
        keyItem={key}
        open={editKeyOpen}
        onOpenChange={setEditKeyOpen}
      />

      <ChangeKeyDialog
        user={user}
        open={changeKeyOpen}
        onOpenChange={setChangeKeyOpen}
      />

      <UserShareDialog
        userId={user.id}
        displayName={user.name}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete ${user.name}?`}
        description={
          "Their record and share link are removed. Their keys are kept and keep working — " +
          "they just stop being attached to anyone. Delete those separately from the server's keys table."
        }
        confirmLabel="Delete user"
        onConfirm={() => removeUser.mutate()}
        isPending={removeUser.isPending}
      />
    </div>
  )
}
