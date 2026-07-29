import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  // Every existing caller confirms an irreversible delete, hence the red
  // button by default — logout and similar non-destructive confirmations
  // pass "default" so the button doesn't imply data loss that isn't there.
  confirmVariant = "destructive",
  onConfirm,
  isPending,
  children,
}: Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  confirmVariant?: "destructive" | "default"
  onConfirm: () => void
  isPending?: boolean
  /** Extra content between the description and the footer — e.g. a field for an optional note. */
  children?: React.ReactNode
}>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
