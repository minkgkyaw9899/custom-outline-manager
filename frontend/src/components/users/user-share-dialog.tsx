import { useState } from "react"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { CopyButton } from "@/components/common/copy-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useResetUserShare, useUserShare } from "@/lib/share"
import { cn } from "@/lib/utils"

/** Where a holder's status page lives, given their share slug. */
export function userShareUrl(slug: string): string {
  return `${window.location.origin}/users/keys-status/${slug}`
}

/**
 * The holder-facing status page link, scoped to the person rather than their
 * key — moving them to another server keeps both this URL and the passcode
 * they chose.
 */
export function UserShareDialog({
  userId,
  displayName,
  open,
  onOpenChange,
}: Readonly<{
  userId: string
  displayName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}>) {
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)

  const { data: share, isLoading, isError } = useUserShare(userId, open)
  const resetShare = useResetUserShare(userId)

  const shareUrl = share ? userShareUrl(share.slug) : ""

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Share {displayName}
            </DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <Skeleton className="h-10" />
          ) : isError || !share ? (
            <p className="text-sm text-destructive">
              Couldn't create the share link. Try again.
            </p>
          ) : (
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">
                  {shareUrl}
                </code>
                <CopyButton value={shareUrl} />
              </div>

              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="gap-1.5">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      share.passcodeSet ? "bg-primary" : "bg-muted-foreground"
                    )}
                  />
                  {share.passcodeSet ? "Active" : "Waiting for setup"}
                </Badge>

                {share.passcodeSet && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmResetOpen(true)}
                  >
                    Reset passcode
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        title="Reset the share passcode?"
        description="The holder will need to set up a new 6-digit passcode the next time they open the link — their current one stops working immediately."
        confirmLabel="Reset passcode"
        onConfirm={() =>
          resetShare.mutate(undefined, {
            onSuccess: () => setConfirmResetOpen(false),
          })
        }
        isPending={resetShare.isPending}
      />
    </>
  )
}
