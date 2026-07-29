import { Badge } from "@/components/ui/badge"
import { SERVER_STATUS_LABEL } from "@/lib/mock-servers"
import type { ServerHealthStatus } from "@/lib/mock-servers"
import { cn } from "@/lib/utils"

/** Tailwind classes keyed by server health, shared by every server surface. */
export const SERVER_STATUS_STYLES: Record<
  ServerHealthStatus,
  { badge: string; dot: string; bar: string; spark: string }
> = {
  healthy: {
    badge: "border-transparent bg-primary/10 text-primary",
    dot: "bg-chart-1",
    bar: "[&_[data-slot=progress-indicator]]:bg-chart-1",
    spark: "bg-chart-1",
  },
  degraded: {
    badge: "border-transparent bg-warning/10 text-warning",
    dot: "bg-warning",
    bar: "[&_[data-slot=progress-indicator]]:bg-warning",
    spark: "bg-warning",
  },
  offline: {
    badge: "border-transparent bg-destructive/10 text-destructive",
    dot: "bg-destructive",
    bar: "[&_[data-slot=progress-indicator]]:bg-destructive",
    spark: "bg-destructive",
  },
}

export function ServerStatusBadge({
  status,
  className,
}: Readonly<{ status: ServerHealthStatus; className?: string }>) {
  const styles = SERVER_STATUS_STYLES[status]

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 text-xs uppercase", styles.badge, className)}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", styles.dot)}
      />
      {SERVER_STATUS_LABEL[status]}
    </Badge>
  )
}
