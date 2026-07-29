import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatBytesCompact, formatDaysLeft } from "@/lib/format"
import type { Key } from "@/lib/types"
import { cn } from "@/lib/utils"

type AttentionReason = "expired" | "limit_exceeded" | "expiring"

const STATUS_BADGE: Record<AttentionReason, string> = {
  expired: "border-transparent bg-destructive/10 text-destructive",
  limit_exceeded: "border-transparent bg-warning/10 text-warning",
  expiring: "border-transparent bg-warning/10 text-warning",
}

const EXPIRING_WITHIN_DAYS = 7

const URGENCY_RANK: Record<AttentionReason, number> = {
  expired: 0,
  limit_exceeded: 1,
  expiring: 2,
}

function urgencyOf(key: Key): AttentionReason | null {
  if (key.status === "expired") return "expired"
  if (key.status === "limit_exceeded") return "limit_exceeded"
  if (
    key.status === "active" &&
    key.daysLeft !== null &&
    key.daysLeft <= EXPIRING_WITHIN_DAYS
  ) {
    return "expiring"
  }
  return null
}

export function KeysAttentionCard({
  keys,
  className,
}: Readonly<{ keys: Key[]; className?: string }>) {
  const attention = keys
    .map((key) => ({ key, reason: urgencyOf(key) }))
    .filter(
      (x): x is { key: Key; reason: AttentionReason } => x.reason !== null
    )
    .sort((a, b) => {
      const rankDiff = URGENCY_RANK[a.reason] - URGENCY_RANK[b.reason]
      if (rankDiff !== 0) return rankDiff
      return (a.key.daysLeft ?? 0) - (b.key.daysLeft ?? 0)
    })

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="font-heading text-lg">
          Keys needing attention
        </CardTitle>
        <span className="text-sm text-muted-foreground">
          {attention.length}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {attention.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing needs attention right now.
          </p>
        ) : (
          attention.map(({ key, reason }) => (
            <div
              key={key.id}
              className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {key.userName || key.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {key.serverName ?? "—"} ·{" "}
                  {key.customLimitBytes === null
                    ? "No limit"
                    : formatBytesCompact(key.customLimitBytes)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-sm text-muted-foreground tabular-nums">
                  {formatBytesCompact(key.usedBytes)}
                </span>
                <Badge
                  variant="outline"
                  className={cn("font-mono uppercase", STATUS_BADGE[reason])}
                >
                  {reason === "expired"
                    ? "Expired"
                    : reason === "limit_exceeded"
                      ? "Limit"
                      : formatDaysLeft(key.daysLeft)}
                </Badge>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
