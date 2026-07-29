import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const DOT_COLOR: Record<string, string> = {
  active: "bg-primary",
  synced: "bg-primary",
  expired: "bg-muted-foreground",
  disabled: "bg-muted-foreground",
  inactive: "bg-muted-foreground",
  never: "bg-muted-foreground",
  limit_exceeded: "bg-destructive",
  suspended: "bg-destructive",
  error: "bg-destructive",
  pending: "bg-muted-foreground",
  approved: "bg-primary",
  rejected: "bg-destructive",
}

const LABEL: Record<string, string> = {
  active: "Active",
  expired: "Expired",
  limit_exceeded: "Limit exceeded",
  disabled: "Disabled",
  inactive: "Inactive",
  suspended: "Suspended",
  synced: "Synced",
  never: "Never synced",
  error: "Sync error",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5", className)}>
      <span
        className={cn("size-1.5 shrink-0 rounded-full", DOT_COLOR[status] ?? "bg-muted-foreground")}
      />
      {LABEL[status] ?? status}
    </Badge>
  )
}
