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

function serverLabel(server: ServerWithUsage): string {
  const capacity =
    server.maxKeys === null
      ? `${server.keyCount} key${server.keyCount === 1 ? "" : "s"}`
      : `${server.keyCount}/${server.maxKeys} keys`
  const quota =
    server.defaultLimitBytes === null
      ? ""
      : ` · ${formatBytesCompact(server.defaultLimitBytes)} default`
  return `${server.name} — ${capacity}${quota}`
}

/**
 * Picks the server a key is provisioned on. Servers already at their key
 * ceiling are listed but not selectable, so the reason a server is unavailable
 * is visible here rather than only as a 409 after submitting.
 */
export function ServerSelect({
  id,
  value,
  onValueChange,
  error,
  label = "Server",
  description,
}: Readonly<{
  id: string
  value: string
  onValueChange: (value: string) => void
  error?: string
  label?: string
  description?: string
}>) {
  const { data: servers, isLoading } = useQuery(serversQueryOptions())

  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={(v) => onValueChange(v ?? "")}>
        <SelectTrigger id={id} aria-invalid={!!error || undefined}>
          <SelectValue placeholder={isLoading ? "Loading servers…" : "Choose a server"}>
            {(selected: string) =>
              servers?.find((s) => s.id === selected)?.name ?? "Choose a server"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {(servers ?? []).map((server) => (
              <SelectItem key={server.id} value={server.id} disabled={isServerFull(server)}>
                {serverLabel(server)}
                {isServerFull(server) && " · full"}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {(error ?? description) && (
        <FieldDescription>{error ?? description}</FieldDescription>
      )}
    </Field>
  )
}
