import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { PlusIcon } from "lucide-react"

import { AddServerDialog } from "@/components/servers/add-server-dialog"
import { ServerCard } from "@/components/servers/server-card"
import { SyncPill } from "@/components/sync-pill"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useIsUserActive } from "@/hooks/use-is-user-active"
import { LIVE_REFRESH_MS, serversQueryOptions } from "@/lib/queries"
import type { ServerHealth } from "@/lib/types"

export const Route = createFileRoute("/_authed/admin/servers/")({
  component: ServersPage,
})

type StatusFilter = "all" | ServerHealth

const FILTER_LABELS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "healthy", label: "Healthy" },
  { value: "degraded", label: "Degraded" },
  { value: "offline", label: "Offline" },
]

function ServersPage() {
  const [filter, setFilter] = useState<StatusFilter>("all")

  // Poll only while the admin is actually at the page: every refresh fans out
  // to every Outline server, so an abandoned tab would keep hitting them.
  const isActive = useIsUserActive()
  const { data: servers, isLoading } = useQuery({
    ...serversQueryOptions(),
    refetchInterval: isActive ? LIVE_REFRESH_MS : false,
  })

  const all = servers ?? []
  const counts: Record<StatusFilter, number> = {
    all: all.length,
    healthy: all.filter((s) => s.health === "healthy").length,
    degraded: all.filter((s) => s.health === "degraded").length,
    offline: all.filter((s) => s.health === "offline").length,
  }

  const visible = filter === "all" ? all : all.filter((s) => s.health === filter)
  const lastSyncedAt = all
    .map((s) => s.lastSyncedAt)
    .filter((v): v is string => v !== null)
    .sort()
    .at(-1)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Dashboard / Servers</p>
          <h1 className="font-heading text-2xl font-semibold">Servers</h1>
        </div>
        <SyncPill lastSyncedAt={lastSyncedAt} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <ToggleGroup
          value={[filter]}
          onValueChange={(v) => {
            if (v.length) setFilter(v[0] as StatusFilter)
          }}
          className="flex-wrap"
        >
          {FILTER_LABELS.map((item) => (
            <ToggleGroupItem
              key={item.value}
              value={item.value}
              className="rounded-full border px-4 text-sm normal-case tracking-normal aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary"
            >
              {item.label} · {counts[item.value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <AddServerDialog>
          <Button>
            <PlusIcon data-icon="inline-start" />
            Add server
          </Button>
        </AddServerDialog>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="font-heading text-lg font-semibold">
            {all.length === 0 ? "No servers yet" : `No ${filter} servers`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {all.length === 0
              ? "Add your first Outline server to start managing keys."
              : "Try a different filter."}
          </p>
        </div>
      ) : (
        // One card per row at every width: a card carries six metrics, an AS
        // list and a chart, so two side by side left each one too cramped to
        // scan.
        <div className="flex flex-col gap-4">
          {visible.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  )
}
