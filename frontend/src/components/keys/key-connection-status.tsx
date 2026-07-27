import { KeyRoundIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A key's avatar with the "connected right now" dot, mirroring Outline
 * Manager's own `access-key-status` element.
 *
 * "Online" is not a session Outline reports — the only liveness signal in its
 * API is `connection.lastTrafficSeen`, so the backend derives `isOnline` from
 * traffic in the last 5 minutes (models.OnlineWindow), the same cutoff the
 * official app uses. A key with no traffic in the metrics window reports
 * offline, which is why this takes a plain boolean rather than a tri-state.
 */
/**
 * What a key is called in the UI. Keys created outside this dashboard can have
 * no name at all, which would otherwise leave rows, action labels and delete
 * confirmations unidentifiable. Outline Manager falls back the same way
 * (resolveKeyName in its www/app.ts).
 */
export function keyDisplayName(
  key: Readonly<{ name: string; outlineKeyId: string }>,
): string {
  return key.name.trim() || `Key ${key.outlineKeyId}`
}

/**
 * The access URL with the key's display name set as its fragment, mirroring
 * how Outline Manager's own share links carry a name (ss://...#<name>).
 * Outline's accessUrl on its own has no name in it, so anywhere the key gets
 * copied out of the dashboard this is what should be handed over instead of
 * the bare URL — otherwise the name is lost the moment it's pasted elsewhere.
 */
export function keyAccessUrlWithName(
  key: Readonly<{ name: string; outlineKeyId: string; accessUrl: string }>,
): string {
  const [base] = key.accessUrl.split("#")
  return `${base}#${encodeURIComponent(keyDisplayName(key))}`
}

/**
 * The link to hand out for a key: the dynamic ssconf:// link when the
 * backend has one configured (PUBLIC_BASE_URL), falling back to the static
 * ss:// link otherwise. Prefer this over keyAccessUrlWithName everywhere a
 * key gets copied or shared out of the dashboard — see dynamicAccessUrl on
 * the Key type for why the dynamic link is the better default.
 */
export function keyShareUrl(
  key: Readonly<{
    name: string
    outlineKeyId: string
    accessUrl: string
    dynamicAccessUrl: string
  }>,
): string {
  return key.dynamicAccessUrl || keyAccessUrlWithName(key)
}

export function KeyConnectionStatus({
  name,
  outlineKeyId,
  isOnline,
  className,
}: Readonly<{
  name: string
  /** Only used for the fallback label on an unnamed key. */
  outlineKeyId: string
  isOnline: boolean
  className?: string
}>) {
  const label = isOnline ? "Connected now" : "Not connected"
  const displayName = keyDisplayName({ name, outlineKeyId })

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        title={label}
      >
        <KeyRoundIcon aria-hidden className="size-4" />
        {isOnline && (
          <span
            aria-hidden
            // ring-card, not ring-background: the dot sits on a Card, so the
            // gap that separates it from the avatar has to match the Card.
            className="absolute right-0 bottom-0 size-2.5 rounded-full bg-chart-1 ring-2 ring-card"
          />
        )}
        <span className="sr-only">{label}</span>
      </span>
      <span className="min-w-0 truncate font-medium">{displayName}</span>
    </span>
  )
}

/**
 * Count of keys connected right now, for a server header. Renders nothing when
 * live metrics are unavailable, since 0 would read as "nobody is connected"
 * rather than "we could not ask".
 */
export function OnlineKeysBadge({
  onlineKeys,
  className,
}: Readonly<{ onlineKeys: number | null | undefined; className?: string }>) {
  if (onlineKeys === null || onlineKeys === undefined) return null

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          onlineKeys > 0 ? "bg-chart-1" : "bg-muted-foreground",
        )}
      />
      {onlineKeys} connected now
    </span>
  )
}
