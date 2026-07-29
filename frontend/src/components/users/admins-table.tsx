import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import type { SortingState } from "@tanstack/react-table"
import { PlusIcon, ShieldIcon, Trash2Icon } from "lucide-react"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { SortableHead } from "@/components/common/data-table-header"
import {
  DEFAULT_PAGE_SIZE,
  DataTablePagination,
} from "@/components/common/data-table-pagination"
import { StatusBadge } from "@/components/common/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiClient } from "@/lib/api"
import { fieldErrorsFrom } from "@/lib/form-errors"
import { formatDateOnly } from "@/lib/format"
import { adminsQueryOptions } from "@/lib/queries"
import type { AdminUser } from "@/lib/types"

/** Adds a dashboard operator. They sign in with an email OTP; no password. */
function NewAdminDialog({ children }: Readonly<{ children: React.ReactNode }>) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  const queryClient = useQueryClient()

  const addAdmin = useMutation({
    mutationFn: () => apiClient.post<AdminUser>("admins", { email: email.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admins"] })
      setEmail("")
      setErrors({})
      setOpen(false)
    },
    onError: (error) => setErrors(fieldErrorsFrom(error)),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) setErrors({})
      }}
    >
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            addAdmin.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading">New admin</DialogTitle>
            <DialogDescription>
              They sign in with a code emailed to this address — there is no
              password and no self-service sign-up.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={!!errors.email || undefined}>
              <FieldLabel htmlFor="admin-email">Email</FieldLabel>
              <Input
                id="admin-email"
                type="email"
                autoComplete="off"
                placeholder="teammate@example.com"
                value={email}
                aria-invalid={!!errors.email || undefined}
                onChange={(e) => setEmail(e.target.value)}
              />
              <FieldDescription>
                {errors.email ??
                  "The address they will receive their sign-in code at."}
              </FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={addAdmin.isPending}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={addAdmin.isPending || !email.trim()}>
              {addAdmin.isPending && <Spinner data-icon="inline-start" />}
              Add admin
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const columnHelper = createColumnHelper<AdminUser>()

export function AdminsTable() {
  const [sorting, setSorting] = useState<SortingState>([])
  const [deleteAdmin, setDeleteAdmin] = useState<AdminUser | null>(null)

  const queryClient = useQueryClient()
  const { data: admins, isLoading } = useQuery(adminsQueryOptions())

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admins"] })

  const removeAdmin = useMutation({
    mutationFn: (admin: AdminUser) =>
      apiClient.delete<null>(`admins/${encodeURIComponent(admin.email)}`),
    onSuccess: () => {
      setDeleteAdmin(null)
      invalidate()
    },
  })

  const setStatus = useMutation({
    mutationFn: ({ admin, status }: { admin: AdminUser; status: AdminUser["status"] }) =>
      apiClient.patch<AdminUser>(
        `admins/${encodeURIComponent(admin.email)}/status`,
        { status },
      ),
    onSuccess: invalidate,
  })

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => row.email, {
        id: "email",
        header: "Email",
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{row.original.email}</span>
            {row.original.isRoot && <Badge variant="outline">Root</Badge>}
          </div>
        ),
      }),
      columnHelper.accessor((row) => row.status, {
        id: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      }),
      columnHelper.accessor((row) => row.createdAt, {
        id: "createdAt",
        header: () => <span className="block text-right">Added</span>,
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs tabular-nums">
            {formatDateOnly(row.original.createdAt)}
          </div>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: () => <span className="block text-right">Actions</span>,
        // The root admin is immutable — the API returns 403 for both of these,
        // so the controls are simply absent rather than present and failing.
        cell: ({ row }) =>
          row.original.isRoot ? (
            <div className="text-right text-xs text-muted-foreground">
              Immutable
            </div>
          ) : (
            <div className="flex items-center justify-end gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={row.original.status === "active"}
                  aria-label={`${row.original.status === "active" ? "Suspend" : "Reactivate"} ${row.original.email}`}
                  disabled={setStatus.isPending}
                  onCheckedChange={(checked) =>
                    setStatus.mutate({
                      admin: row.original,
                      status: checked ? "active" : "suspended",
                    })
                  }
                />
                Active
              </label>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={`Remove ${row.original.email}`}
                title="Remove admin"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteAdmin(row.original)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          ),
      }),
    ],
    [setStatus],
  )

  const table = useReactTable({
    data: admins ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: DEFAULT_PAGE_SIZE } },
  })

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="font-heading text-lg">
            Admins ({admins?.length ?? 0})
          </CardTitle>
          <CardDescription>
            Suspending an admin blocks their sign-in without removing them.
          </CardDescription>
        </div>
        <div className="flex w-full justify-end">
          <NewAdminDialog>
            <Button size="sm" variant="outline">
              <PlusIcon data-icon="inline-start" />
              New admin
            </Button>
          </NewAdminDialog>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (admins?.length ?? 0) === 0 ? (
          <Empty />
        ) : (
          <>
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <SortableHead
                        key={header.id}
                        header={header}
                        align={
                          ["createdAt", "actions"].includes(header.column.id)
                            ? "end"
                            : "start"
                        }
                      />
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <DataTablePagination table={table} unit="admin" />
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={deleteAdmin !== null}
        onOpenChange={(open) => !open && setDeleteAdmin(null)}
        title={`Remove ${deleteAdmin?.email ?? "this admin"}?`}
        description="They lose access to this dashboard immediately. Any active session of theirs stops working on its next request."
        confirmLabel="Remove admin"
        onConfirm={() => deleteAdmin && removeAdmin.mutate(deleteAdmin)}
        isPending={removeAdmin.isPending}
      />
    </Card>
  )
}

/**
 * Unreachable in practice — the root admin is seeded by migration and cannot
 * be deleted — but the table should not render a bare header if it ever is.
 */
function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border py-10 text-center">
      <ShieldIcon className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">No admins yet.</p>
    </div>
  )
}
