export const BYTES_PER_GB = 1_000_000_000

/**
 * The plan floor every key is sold at. Mirrors models.MinPlanGB /
 * models.MinPlanDays on the backend, which rejects anything smaller: a key is
 * never created or extended with less than one period.
 */
export const MIN_PLAN_GB = 200
export const MIN_PLAN_DAYS = 30

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—"
  if (bytes === 0) return "0 GB"
  const gb = bytes / BYTES_PER_GB
  if (gb < 0.01) return `${(bytes / 1_000_000).toFixed(2)} MB`
  return `${gb.toFixed(2)} GB`
}

/**
 * Short byte label for dense UI: "11.4 TB", "900 GB".
 *
 * By default trailing zeros are trimmed, which is what chart axes want ("900 GB",
 * not "900.0 GB"). Pass `decimals` to pin the precision instead — summary figures
 * in the design keep one decimal even when whole ("4.0 TB").
 */
export function formatBytesCompact(
  bytes: number | null | undefined,
  options?: { decimals?: number },
): string {
  if (bytes === null || bytes === undefined) return "—"

  const scale = (value: number, unit: string) => {
    const fixed = value.toFixed(options?.decimals ?? 1)
    return `${options?.decimals === undefined ? parseFloat(fixed) : fixed} ${unit}`
  }

  if (bytes >= 1e12) return scale(bytes / 1e12, "TB")
  if (bytes >= BYTES_PER_GB) return scale(bytes / BYTES_PER_GB, "GB")
  if (bytes >= 1e6) return scale(bytes / 1e6, "MB")
  return `${bytes} B`
}

/**
 * Usage against its cap in one shared unit — "6.9/200 GB".
 *
 * Both halves are scaled by the larger of the two so the pair reads as a single
 * fraction; formatting each side independently would put "690 MB / 200 GB" in a
 * cell where the whole point is comparing them at a glance. An unmetered key
 * has no cap to divide by, so it falls back to the plain used figure.
 */
export function formatUsagePair(
  usedBytes: number,
  limitBytes: number | null,
): string {
  if (limitBytes === null) return formatBytesCompact(usedBytes, { decimals: 1 })

  const ceiling = Math.max(usedBytes, limitBytes)
  const [divisor, unit] =
    ceiling >= 1e12
      ? [1e12, "TB"]
      : ceiling >= BYTES_PER_GB
        ? [BYTES_PER_GB, "GB"]
        : ceiling >= 1e6
          ? [1e6, "MB"]
          : [1, "B"]

  const scaled = (bytes: number) => parseFloat((bytes / divisor).toFixed(1))
  return `${scaled(usedBytes)}/${scaled(limitBytes)} ${unit}`
}

/**
 * Bandwidth *rate*, e.g. "18 kB/s". Outline reports current and peak bandwidth
 * in bytes per second — not a total, so this must never be formatted with
 * formatBytes.
 */
export function formatBandwidth(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond === null || bytesPerSecond === undefined) return "—"
  if (bytesPerSecond >= 1e9) return `${(bytesPerSecond / 1e9).toFixed(1)} GB/s`
  if (bytesPerSecond >= 1e6) return `${(bytesPerSecond / 1e6).toFixed(1)} MB/s`
  if (bytesPerSecond >= 1e3) return `${Math.round(bytesPerSecond / 1e3)} kB/s`
  return `${Math.round(bytesPerSecond)} B/s`
}

/** Tunnel time, matching Outline Manager's own "8.886 hours" presentation. */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return "—"
  if (hours < 1) return `${Math.round(hours * 60)} min`
  return `${hours.toFixed(hours < 10 ? 3 : 1)} hours`
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "Never"
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 0) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function gbToBytes(gb: number): number {
  return Math.round(gb * BYTES_PER_GB)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })
}

export function formatDaysLeft(days: number | null | undefined): string {
  if (days === null || days === undefined) return "No expiry"
  if (days < 0) return "Expired"
  if (days === 0) return "Expires today"
  return `${days} day${days === 1 ? "" : "s"} left`
}

export function formatMmk(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} MMK`
}
