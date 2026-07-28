import { DetailRow } from "@/components/detail-row"
import { DynamicLinkRecommendedBadge } from "@/components/keys/dynamic-link-info-dialog"
import { KeyLinkField } from "@/components/keys/key-link-field"
import { KeyUsageDonut } from "@/components/keys/key-usage-donut"
import { ServerStatusBadge } from "@/components/server-status-badge"
import { DailyTrafficCard } from "@/components/servers/daily-traffic-card"
import { StatCard } from "@/components/stat-card"
import { StatusBadge } from "@/components/status-badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  formatBytesCompact,
  formatDate,
  formatDateOnly,
  formatDaysLeft,
  formatHours,
  formatRelativeTime,
  formatUsagePair,
} from "@/lib/format"
import type { ShareKeyView } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Matches the admin key detail page: green until three quarters spent, red at the cap. */
function usageBarColor(ratio: number): string {
  if (ratio >= 1) return "bg-destructive"
  if (ratio >= 0.75) return "bg-chart-3"
  return "bg-chart-1"
}

function UsageBar({ data }: Readonly<{ data: ShareKeyView }>) {
  if (data.customLimitBytes === null) {
    return (
      <p className="text-sm text-muted-foreground">
        No data limit set on this key.
      </p>
    )
  }
  const ratio =
    data.customLimitBytes === 0
      ? 1
      : data.usedBytes / data.customLimitBytes
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
          {formatUsagePair(data.usedBytes, data.customLimitBytes)}
        </span>
        <span className="tabular-nums">{Math.round(ratio * 100)}% used</span>
      </div>
    </div>
  )
}

/**
 * The key holder's read-only status page. A deliberately trimmed mirror of
 * the admin key detail page: no renewal/limit history, no edit/delete, and
 * the Connection card only carries the static and dynamic links, host,
 * created and last-updated — no port, cipher, server link or Outline key id.
 */
export function KeyStatusView({ data }: Readonly<{ data: ShareKeyView }>) {
  const metrics = data.metrics

  // The link belongs to the holder, not to a key, so it stays valid through a
  // gap where they have none — between one key being removed and the next
  // being issued. Everything below reads from a key, so there is nothing to
  // show until then.
  if (!data.hasKey) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold">{data.name}</h1>
        <p className="text-sm text-muted-foreground">
          There is no access key on this account right now. This page will show
          your connection and remaining data as soon as one is issued — the link
          you have stays the same, so keep it.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="font-heading text-2xl font-semibold">{data.name}</h1>
        <StatusBadge status={data.status} />
      </div>

      {metrics === null && (
        <p className="text-sm text-muted-foreground">
          Live metrics are unavailable right now. Usage and quota below come
          from the last successful sync.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 md:gap-4 xl:grid-cols-4">
        <StatCard
          label="Data usage"
          value={formatUsagePair(data.usedBytes, data.customLimitBytes)}
          note={
            data.remainingBytes === null
              ? "No limit"
              : `${formatBytesCompact(data.remainingBytes, { decimals: 1 })} remaining`
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
          <CardHeader>
            <CardTitle className="font-heading text-lg">Plan</CardTitle>
            <CardDescription>
              Quota and expiry as of the last sync with the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <UsageBar data={data} />
            <dl className="flex flex-col">
              <DetailRow label="Data used">
                <span className="font-mono tabular-nums">
                  {formatBytesCompact(data.usedBytes, { decimals: 1 })}
                </span>
              </DetailRow>
              <DetailRow label="Data limit">
                <span className="font-mono tabular-nums">
                  {data.customLimitBytes === null
                    ? "No limit"
                    : formatBytesCompact(data.customLimitBytes, {
                        decimals: 1,
                      })}
                </span>
              </DetailRow>
              <DetailRow label="Remaining">
                <span className="font-mono tabular-nums">
                  {data.remainingBytes === null
                    ? "—"
                    : formatBytesCompact(data.remainingBytes, {
                        decimals: 1,
                      })}
                </span>
              </DetailRow>
              <DetailRow label="Expires">
                <span className="font-mono tabular-nums">
                  {formatDateOnly(data.endDate)}
                </span>
              </DetailRow>
              <DetailRow label="Time left">
                {formatDaysLeft(data.daysLeft)}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Connection</CardTitle>
            <CardDescription>Your access links and where they connect.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <KeyLinkField
              label="Dynamic key"
              value={data.dynamicAccessUrl}
              emptyNote="Not configured for this server."
              badge={
                data.dynamicAccessUrl ? (
                  <DynamicLinkRecommendedBadge audience="holder" />
                ) : undefined
              }
            />
            <KeyLinkField label="Static key" value={data.accessUrl} />
            <dl className="flex flex-col">
              <DetailRow label="Host">
                <span className="font-mono text-xs">{data.host || "—"}</span>
              </DetailRow>
              {data.serverHealth && (
                <DetailRow label="Server status">
                  <ServerStatusBadge status={data.serverHealth} />
                </DetailRow>
              )}
              <DetailRow label="Created">{formatDate(data.createdAt)}</DetailRow>
              <DetailRow label="Last updated">
                {formatDate(data.updatedAt)}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DailyTrafficCard
            series={data.dailySeries}
            granularity={data.dailyGranularity}
          />
        </div>
        <KeyUsageDonut keyItem={data} />
      </div>
    </div>
  )
}
