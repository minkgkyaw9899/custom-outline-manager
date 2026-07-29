import { useQuery } from "@tanstack/react-query"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatBytesCompact } from "@/lib/format"
import { serversQueryOptions } from "@/lib/queries"
import type { ServerWithUsage } from "@/lib/types"

/** A server is full when it has as many keys as its ceiling allows. */
export function isServerFull(server: ServerWithUsage): boolean {
  return server.maxKeys !== null && server.keyCount >= server.maxKeys
}

function serverLabel(server: ServerWithUsage, claimableCount: number): string {
  const capacity =
    server.maxKeys === null
      ? `${server.keyCount} key${server.keyCount === 1 ? "" : "s"}`
      : `${server.keyCount}/${server.maxKeys} keys`
  const quota =
    server.defaultLimitBytes === null
      ? ""
      : ` · ${formatBytesCompact(server.defaultLimitBytes)} default`
  const spare =
    isServerFull(server) && claimableCount > 0
      ? ` · full, ${claimableCount} spare key${claimableCount === 1 ? "" : "s"}`
      : ""
  return `${server.name} — ${capacity}${quota}${spare}`
}

/**
 * A server is unavailable when it's full with nothing to hand out instead: a
 * spare key that was provisioned but never used or attached to anyone can
 * still be claimed on a full server, so that alone doesn't rule it out.
 */
export function isServerUnavailable(
  server: ServerWithUsage,
  claimableCount: number
): boolean {
  return isServerFull(server) && claimableCount === 0
}

/**
 * Picks the server a key comes from. Servers at their key ceiling are listed
 * but not selectable — unless they have a spare key (provisioned, never used,
 * never attached to anyone) that can be handed out instead of creating a new
 * one, in which case they stay selectable and the caller is expected to
 * steer the caller toward claiming that key rather than provisioning.
 */
export function ServerSelect({
  id,
  value,
  onValueChange,
  error,
  label = "Server",
  description,
  claimableKeyCounts = {},
}: Readonly<{
  id: string
  value: string
  onValueChange: (value: string) => void
  error?: string
  label?: string
  description?: string
  /** Server id → count of unassigned, never-used keys that could be claimed instead of provisioning. */
  claimableKeyCounts?: Record<string, number>
}>) {
  const { data: servers, isLoading } = useQuery(serversQueryOptions())

  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={(v) => onValueChange(v ?? "")}>
        <SelectTrigger id={id} aria-invalid={!!error || undefined}>
          <SelectValue
            placeholder={isLoading ? "Loading servers…" : "Choose a server"}
          >
            {(selected: string) =>
              servers?.find((s) => s.id === selected)?.name ?? "Choose a server"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {(servers ?? []).map((server) => {
              const claimable = claimableKeyCounts[server.id] ?? 0
              return (
                <SelectItem
                  key={server.id}
                  value={server.id}
                  disabled={isServerUnavailable(server, claimable)}
                >
                  {serverLabel(server, claimable)}
                  {isServerUnavailable(server, claimable) && " · full"}
                </SelectItem>
              )
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
      {(error ?? description) && (
        <FieldDescription>{error ?? description}</FieldDescription>
      )}
    </Field>
  )
}
