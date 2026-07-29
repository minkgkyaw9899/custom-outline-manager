import { Button } from "@/components/ui/button"
import { formatRelativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Fleet sync freshness. Reflects the most recent successful sync across the
 * servers in view; the dot stops pulsing once nothing has synced in a while,
 * so a stalled cron is visible rather than looking permanently live.
 */
const STALE_AFTER_MS = 5 * 60_000

export function SyncPill({
  lastSyncedAt,
}: Readonly<{ lastSyncedAt?: string | null }>) {
  const stale =
    !lastSyncedAt ||
    Date.now() - new Date(lastSyncedAt).getTime() > STALE_AFTER_MS

  return (
    <Button
      variant="outline"
      className={cn(
        "rounded-full",
        stale
          ? "text-muted-foreground"
          : "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
      )}
    >
      <span
        aria-hidden
        data-icon="inline-start"
        className={cn(
          "size-2 rounded-full",
          stale ? "bg-muted-foreground" : "animate-pulse bg-primary"
        )}
      />
      Sync {formatRelativeTime(lastSyncedAt)}
    </Button>
  )
}
