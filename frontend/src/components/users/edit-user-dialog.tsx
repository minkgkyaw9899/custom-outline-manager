import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { apiClient } from "@/lib/api"
import { fieldErrorsFrom } from "@/lib/form-errors"
import type { UserWithKeys } from "@/lib/types"

/**
 * Edits the person, not their key: name, note, and whether they are still an
 * active holder. The key's own plan is edited separately — these are different
 * decisions with different consequences.
 *
 * Only changed fields are sent. The backend treats an omitted field as "leave
 * it" and an empty string as "clear it", so a blanked note has to go over the
 * wire as "" rather than being dropped.
 */
export function EditUserDialog({
  user,
  open,
  onOpenChange,
}: Readonly<{
  user: UserWithKeys | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}>) {
  const [name, setName] = useState("")
  const [note, setNote] = useState("")
  const [active, setActive] = useState(true)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const queryClient = useQueryClient()

  // Reopening must not carry the last edit over.
  useEffect(() => {
    if (open && user) {
      setName(user.name)
      setNote(user.note)
      setActive(user.status === "active")
      setErrors({})
    }
  }, [open, user])

  const trimmed = { name: name.trim(), note: note.trim() }
  const changed = user
    ? {
        name: trimmed.name !== user.name,
        note: trimmed.note !== user.note,
        status: active !== (user.status === "active"),
      }
    : { name: false, note: false, status: false }
  const nothingToDo = !Object.values(changed).some(Boolean)

  const save = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("No user selected")
      return apiClient.patch<UserWithKeys>(`users/${user.id}`, {
        ...(changed.name ? { name: trimmed.name } : {}),
        ...(changed.note ? { note: trimmed.note } : {}),
        ...(changed.status ? { status: active ? "active" : "inactive" } : {}),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
      onOpenChange(false)
    },
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading">
              Edit {user?.name ?? "user"}
            </DialogTitle>
            <DialogDescription>
              Their details and whether they are still an active holder. Their
              share link and access key are unaffected.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="edit-user-name">Name</FieldLabel>
              <Input
                id="edit-user-name"
                autoComplete="off"
                value={name}
                aria-invalid={!!errors.name || undefined}
                onChange={(e) => setName(e.target.value)}
              />
              <FieldDescription>
                {errors.name ?? "Also the title of their status page."}
              </FieldDescription>
            </Field>

            <Field data-invalid={!!errors.note || undefined}>
              <FieldLabel htmlFor="edit-user-note">Note</FieldLabel>
              <Textarea
                id="edit-user-note"
                rows={2}
                value={note}
                aria-invalid={!!errors.note || undefined}
                onChange={(e) => setNote(e.target.value)}
              />
              {errors.note && <FieldDescription>{errors.note}</FieldDescription>}
            </Field>

            <Field orientation="horizontal">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="edit-user-status">Active holder</FieldLabel>
                <FieldDescription>
                  A record-keeping flag. Switching it off does not disable their
                  key — set the key's limit or expiry for that.
                </FieldDescription>
              </div>
              <Switch
                id="edit-user-status"
                checked={active}
                onCheckedChange={setActive}
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={save.isPending}>
                  Cancel
                </Button>
              }
            />
            <Button
              type="submit"
              disabled={save.isPending || nothingToDo || !trimmed.name}
            >
              {save.isPending && <Spinner data-icon="inline-start" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
