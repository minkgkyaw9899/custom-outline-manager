import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  initialKeySource,
  isKeySourceIncomplete,
  KeySourceFields,
  keySourcePayload,
} from "@/components/users/key-source-fields"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { apiClient } from "@/lib/api"
import { fieldErrorsFrom } from "@/lib/form-errors"
import type { UserWithKeys } from "@/lib/types"

/**
 * Registers a key holder and, optionally, provisions their first key in the
 * same submit.
 *
 * The key is optional because a holder is sometimes recorded before there is a
 * server to put them on. When one is chosen, the whole thing is atomic on the
 * backend: a key that can't be created rolls the user back too, rather than
 * leaving a half-registered person behind.
 */
export function NewUserDialog({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [note, setNote] = useState("")
  const [withKey, setWithKey] = useState(true)
  const [keySource, setKeySource] = useState(initialKeySource)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const queryClient = useQueryClient()

  function reset() {
    setName("")
    setNote("")
    setWithKey(true)
    setKeySource(initialKeySource())
    setErrors({})
  }

  const createUser = useMutation({
    mutationFn: () => {
      // `name` on this endpoint is the *user's* name, so the new key's name
      // travels as `keyName` here — everywhere else it is plain `name`.
      const { name: newKeyName, ...source } = keySourcePayload(keySource, {
        includePlan: true,
      })
      return apiClient.post<UserWithKeys>("users", {
        name: name.trim(),
        note: note.trim(),
        ...(withKey
          ? { ...source, ...(newKeyName ? { keyName: newKeyName } : {}) }
          : {}),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      queryClient.invalidateQueries({ queryKey: ["stats"] })
      reset()
      setOpen(false)
    },
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  const keyIncomplete =
    withKey && isKeySourceIncomplete(keySource, { requirePlan: true })

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) reset()
      }}
    >
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createUser.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading">New user</DialogTitle>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="user-name">Name</FieldLabel>
              <Input
                id="user-name"
                autoComplete="off"
                placeholder="Aung Aung"
                value={name}
                aria-invalid={!!errors.name || undefined}
                onChange={(e) => setName(e.target.value)}
              />
              <FieldDescription>
                {errors.name ??
                  "Used as the key's name and the title of their status page."}
              </FieldDescription>
            </Field>

            <Field data-invalid={!!errors.note || undefined}>
              <FieldLabel htmlFor="user-note">Note (optional)</FieldLabel>
              <Textarea
                id="user-note"
                rows={2}
                placeholder="Paid through March, prefers Telegram"
                value={note}
                aria-invalid={!!errors.note || undefined}
                onChange={(e) => setNote(e.target.value)}
              />
              {errors.note && (
                <FieldDescription>{errors.note}</FieldDescription>
              )}
            </Field>

            <FieldSet>
              <div className="flex items-center justify-between gap-3">
                <FieldLegend className="mb-0">Access key</FieldLegend>
                <Switch
                  checked={withKey}
                  onCheckedChange={setWithKey}
                  aria-label="Create an access key for this user"
                />
              </div>
              {withKey ? (
                <KeySourceFields
                  idPrefix="user"
                  value={keySource}
                  onChange={setKeySource}
                  errors={errors}
                  keyNamePlaceholder={
                    name.trim() || "Defaults to the user's name"
                  }
                  overridePlanOnClaim
                />
              ) : (
                <FieldDescription>
                  The user is recorded with no key. Their link exists but
                  resolves to nothing until you give them one.
                </FieldDescription>
              )}
            </FieldSet>
          </FieldGroup>

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={createUser.isPending}
                >
                  Cancel
                </Button>
              }
            />
            <Button
              type="submit"
              disabled={createUser.isPending || !name.trim() || keyIncomplete}
            >
              {createUser.isPending && <Spinner data-icon="inline-start" />}
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
