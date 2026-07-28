import { ServerStatusBadge } from "@/components/server-status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatRelativeTime } from "@/lib/format"
import type { ServerWithUsage } from "@/lib/types"

export function FleetHealthCard({
  servers,
  className,
}: Readonly<{ servers: ServerWithUsage[]; className?: string }>) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Fleet health</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No servers yet.</p>
        ) : (
          servers.map((server) => (
            <div
              key={server.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{server.name}</p>
                <p className="text-xs text-muted-foreground">
                  {server.activeKeys} / {server.keyCount} keys active
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <ServerStatusBadge status={server.health} />
                <span className="text-xs text-muted-foreground">
                  Synced {formatRelativeTime(server.lastSyncedAt)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
