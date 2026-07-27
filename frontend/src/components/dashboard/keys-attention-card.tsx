import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatBytesCompact } from "@/lib/format"
import { ATTENTION_KEYS } from "@/lib/mock-dashboard"
import type { AttentionStatus } from "@/lib/mock-dashboard"
import { cn } from "@/lib/utils"

const STATUS_BADGE: Record<AttentionStatus, string> = {
  expiring: "border-transparent bg-warning/10 text-warning",
  limit: "border-transparent bg-warning/10 text-warning",
  expired: "border-transparent bg-destructive/10 text-destructive",
}

export function KeysAttentionCard({ className }: Readonly<{ className?: string }>) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="font-heading text-lg">Keys needing attention</CardTitle>
        <Button variant="link" size="sm" className="text-primary">
          View all
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {ATTENTION_KEYS.map((key) => (
          <div
            key={key.id}
            className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {key.name} — {key.plan}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {key.serverName} · {key.carrier}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {formatBytesCompact(key.usedBytes)}
              </span>
              <Badge
                variant="outline"
                className={cn("font-mono uppercase", STATUS_BADGE[key.status])}
              >
                {key.statusLabel}
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
