import { formatBytesCompact } from "@/lib/format"
import type { ASUsage } from "@/lib/types"

/**
 * Colours cycle by rank rather than being keyed by name: unlike the fixed set
 * of mobile carriers the design assumed, the AS list is open-ended and differs
 * per server, so there is no stable name→colour mapping to hold onto.
 */
const AS_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-5)",
  "var(--chart-4)",
]

export function AsShareList({
  ases,
  limit = 4,
  showBytes = false,
  hideCaption = false,
}: Readonly<{
  ases: ASUsage[]
  limit?: number
  showBytes?: boolean
  /** Set when the surrounding card already labels the section. */
  hideCaption?: boolean
}>) {
  if (ases.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No AS traffic reported in this window.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hideCaption && (
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Top ASes
        </span>
      )}
      {ases.slice(0, limit).map((as, i) => (
        <span
          key={as.asn}
          className="flex items-center gap-1.5 rounded-full border bg-muted/30 px-2.5 py-1 text-xs"
          title={`AS${as.asn} · ${as.countryCode} · ${formatBytesCompact(as.bytesTransferred)}`}
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: AS_COLORS[i % AS_COLORS.length] }}
          />
          {as.asOrg} · {Math.round(as.sharePct)}%
          {showBytes && (
            <span className="font-mono text-muted-foreground">
              {formatBytesCompact(as.bytesTransferred)}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
