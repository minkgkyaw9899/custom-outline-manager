import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  initialKeySource,
  isKeySourceIncomplete,
  KeySourceFields,
  keySourcePayload,
} from "@/components/users/key-source-fields"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { apiClient } from "@/lib/api"
import { fieldErrorsFrom } from "@/lib/form-errors"
import type { UserWithKeys } from "@/lib/types"

/**
 * Moves a holder onto a fresh key, on any server.
 *
 * The link they were given does not change: it resolves through the user, so
 * pointing them at a new key is invisible from their side — their Outline
 * client picks up the new connection on its next refresh, with no re-install
 * and no new URL to send.
 *
 * Their old key is released rather than deleted, so it keeps working and keeps
 * its usage history until it is explicitly deleted from the server's key table.
 */
export function ChangeKeyDialog({
  user,
  open,
  onOpenChange,
}: Readonly<{
  user: UserWithKeys | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}>) {
  const [keySource, setKeySource] = useState(initialKeySource)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const queryClient = useQueryClient()

  useEffect(() => {
    if (open && user) {
      // Deliberately not pre-selecting their current server: the point of this
      // dialog is choosing where they go next, and a pre-filled answer invites
      // submitting without reading it.
      setKeySource(initialKeySource())
      setErrors({})
    }
  }, [open, user])

  const replaceKey = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("No user selected")
      return apiClient.post<UserWithKeys>(
        `users/${user.id}/keys/replace`,
        keySourcePayload(keySource),
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      queryClient.invalidateQueries({ queryKey: ["stats"] })
      onOpenChange(false)
    },
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  const current = user?.primaryKey

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            replaceKey.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading">
              Change key for {user?.name ?? "user"}
            </DialogTitle>
            <DialogDescription>
              Creates a new key on the server you choose and points this
              holder's existing link at it.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            {current && (
              <Alert>
                <AlertTitle>
                  Currently on {current.serverName ?? "a server"} ·{" "}
                  {current.name || "unnamed key"}
                </AlertTitle>
                <AlertDescription>
                  That key is kept and keeps working — it just stops being
                  attached to this holder. Delete it from the server's key table
                  if you don't want it around.
                </AlertDescription>
              </Alert>
            )}

            <KeySourceFields
              idPrefix="change-key"
              serverLabel="Move to server"
              value={keySource}
              onChange={setKeySource}
              errors={errors}
              keyNamePlaceholder={user?.name ?? "Defaults to the user's name"}
            />
          </FieldGroup>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={replaceKey.isPending}>
                  Cancel
                </Button>
              }
            />
            <Button
              type="submit"
              disabled={replaceKey.isPending || isKeySourceIncomplete(keySource)}
            >
              {replaceKey.isPending && <Spinner data-icon="inline-start" />}
              Change key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
