import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { apiClient } from "@/lib/api"

interface SyncAllResult {
  total: number
  synced: number
  failed: number
}

/**
 * Triggers POST /servers/sync-all, which blocks server-side until every
 * server has synced (or timed out) and returns a real pass/fail count — the
 * result message is toasted automatically by apiClient (see api.ts), so this
 * only needs to invalidate whatever screens show synced data. Used on both
 * the servers list and the users list, since a holder's usage/status on the
 * users table comes from the same per-server sync.
 */
export function SyncAllButton() {
  const queryClient = useQueryClient()

  const syncAll = useMutation({
    mutationFn: () => apiClient.post<SyncAllResult>("servers/sync-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      queryClient.invalidateQueries({ queryKey: ["users"] })
      queryClient.invalidateQueries({ queryKey: ["stats"] })
    },
  })

  return (
    <Button
      variant="outline"
      onClick={() => syncAll.mutate()}
      disabled={syncAll.isPending}
    >
      {syncAll.isPending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <RefreshCwIcon data-icon="inline-start" />
      )}
      Sync all servers
    </Button>
  )
}
