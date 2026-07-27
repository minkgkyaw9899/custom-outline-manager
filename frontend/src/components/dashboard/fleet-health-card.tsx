import { SERVER_STATUS_STYLES } from "@/components/server-status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { AVG_LATENCY_MS, OVERVIEW_SERVERS } from "@/lib/mock-dashboard"
import { cn } from "@/lib/utils"

export function FleetHealthCard({ className }: Readonly<{ className?: string }>) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Fleet health</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        {OVERVIEW_SERVERS.map((server) => (
          <div key={server.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  SERVER_STATUS_STYLES[server.status].dot,
                )}
              />
              <span className="flex-1 truncate text-sm font-medium">{server.name}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {server.loadPct}%
              </span>
            </div>
            <Progress
              value={server.loadPct}
              aria-label={`${server.name} load`}
              className={cn(
                "gap-0 [&_[data-slot=progress-track]]:h-1 [&_[data-slot=progress-track]]:rounded-full",
                SERVER_STATUS_STYLES[server.status].bar,
              )}
            />
          </div>
        ))}
        <div className="mt-auto flex flex-col gap-4">
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Avg latency</span>
            <span className="font-mono text-sm tabular-nums">{AVG_LATENCY_MS} ms</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
