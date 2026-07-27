import { useMemo, useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import type { SortingState } from "@tanstack/react-table"
import { PlusIcon, Trash2Icon, UsersIcon } from "lucide-react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { SortableHead } from "@/components/data-table-header"
import {
  DEFAULT_PAGE_SIZE,
  DataTablePagination,
} from "@/components/data-table-pagination"
import { NewUserDialog } from "@/components/users/new-user-dialog"
import { StatusBadge } from "@/components/status-badge"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiClient } from "@/lib/api"
import {
  formatBytesCompact,
  formatDateOnly,
  formatDaysLeft,
  formatUsagePair,
} from "@/lib/format"
import type { UserWithKeys } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * A holder's status is really their key's: "active" here means they have a
 * working connection right now, which is what the admin is scanning the table
 * for. Their own record being inactive overrides that — a suspended holder is
 * not active whatever their key says.
 */
function holderStatus(user: UserWithKeys): string {
  if (user.status === "inactive") return "inactive"
  return user.primaryKey?.status ?? "disabled"
}

function UsageCell({ user }: Readonly<{ user: UserWithKeys }>) {
  const key = user.primaryKey
  if (!key) return <span className="text-sm text-muted-foreground">—</span>
  if (key.customLimitBytes === null) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-xs tabular-nums">
          {formatBytesCompact(key.usedBytes, { decimals: 1 })}
        </span>
        <span className="text-xs text-muted-foreground">No limit</span>
      </div>
    )
  }
  const ratio =
    key.customLimitBytes === 0 ? 1 : key.usedBytes / key.customLimitBytes
  return (
    <div className="flex min-w-36 flex-col gap-1.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            ratio >= 1 ? "bg-destructive" : ratio >= 0.75 ? "bg-chart-3" : "bg-chart-1",
          )}
          style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {formatUsagePair(key.usedBytes, key.customLimitBytes)}
      </span>
    </div>
  )
}

function ExpiryCell({ user }: Readonly<{ user: UserWithKeys }>) {
  const key = user.primaryKey
  if (!key || key.endDate === null) {
    return <span className="text-sm text-muted-foreground">—</span>
  }
  const expired = key.daysLeft !== null && key.daysLeft <= 0
  const soon = key.daysLeft !== null && key.daysLeft > 0 && key.daysLeft <= 7
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-mono text-xs tabular-nums">
        {formatDateOnly(key.endDate)}
      </span>
      <Badge
        variant="outline"
        className={cn(
          "text-[11px]",
          expired && "border-destructive/30 text-destructive",
          soon && "border-chart-3/40 text-chart-3",
        )}
      >
        {formatDaysLeft(key.daysLeft)}
      </Badge>
    </div>
  )
}

const columnHelper = createColumnHelper<UserWithKeys>()

export function UsersTable({
  users,
  isLoading,
}: Readonly<{ users: UserWithKeys[]; isLoading: boolean }>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [search, setSearch] = useState("")
  const [deleteUser, setDeleteUser] = useState<UserWithKeys | null>(null)

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const removeUser = useMutation({
    mutationFn: (user: UserWithKeys) => apiClient.delete<null>(`users/${user.id}`),
    onSuccess: () => {
      setDeleteUser(null)
      queryClient.invalidateQueries({ queryKey: ["users"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
    },
  })

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => row.name, {
        id: "name",
        header: "Name",
        // The row opens the user; the name carries the real link so the row
        // stays reachable by keyboard and middle-click.
        cell: ({ row }) => (
          <Link
            to="/admin/users/$userId"
            params={{ userId: row.original.id }}
            className="flex flex-col hover:underline"
          >
            <span className="font-medium">{row.original.name}</span>
            {row.original.note && (
              <span className="max-w-56 truncate text-xs text-muted-foreground">
                {row.original.note}
              </span>
            )}
          </Link>
        ),
      }),
      columnHelper.accessor((row) => holderStatus(row), {
        id: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={holderStatus(row.original)} />,
      }),
      columnHelper.accessor((row) => row.primaryKey?.serverName ?? "", {
        id: "server",
        header: "Server",
        cell: ({ row }) =>
          row.original.primaryKey ? (
            <Link
              to="/admin/servers/$serverId"
              params={{ serverId: row.original.primaryKey.serverId }}
              className="text-sm hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.primaryKey.serverName ?? "—"}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">No key</span>
          ),
      }),
      columnHelper.accessor((row) => row.primaryKey?.name ?? "", {
        id: "keyName",
        header: "Key name",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.primaryKey?.name || "—"}</span>
        ),
      }),
      columnHelper.accessor(
        (row) =>
          row.primaryKey?.customLimitBytes
            ? row.primaryKey.usedBytes / row.primaryKey.customLimitBytes
            : 0,
        {
          id: "usage",
          header: "Usage",
          cell: ({ row }) => <UsageCell user={row.original} />,
        },
      ),
      columnHelper.accessor((row) => row.primaryKey?.daysLeft ?? Infinity, {
        id: "expiry",
        header: () => <span className="block text-right">Expiry</span>,
        cell: ({ row }) => <ExpiryCell user={row.original} />,
      }),
      columnHelper.display({
        id: "actions",
        header: () => <span className="block text-right">Actions</span>,
        cell: ({ row }) => (
          // The row opens the user, so controls inside it stop the click first.
          <div
            className="flex items-center justify-end gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={`Delete ${row.original.name}`}
              title="Delete user"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteUser(row.original)}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
        ),
      }),
    ],
    [],
  )

  const table = useReactTable({
    data: users,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: DEFAULT_PAGE_SIZE } },
  })

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="font-heading text-lg">
            Users ({users.length})
          </CardTitle>
          <CardDescription>
            The people holding keys. Open a row for their detail, where you can
            change their server or key without changing the link they were sent.
          </CardDescription>
        </div>

        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Input
            className="h-8 max-w-56"
            placeholder="Search users…"
            aria-label="Search users"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              table.setPageIndex(0)
            }}
          />
          <NewUserDialog>
            <Button size="sm">
              <PlusIcon data-icon="inline-start" />
              New user
            </Button>
          </NewUserDialog>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : users.length === 0 ? (
          <Empty className="rounded-lg border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>No users yet</EmptyTitle>
              <EmptyDescription>
                Add the people you hand keys to, so their access follows them
                rather than the key.
              </EmptyDescription>
            </EmptyHeader>
            <NewUserDialog>
              <Button>
                <PlusIcon data-icon="inline-start" />
                New user
              </Button>
            </NewUserDialog>
          </Empty>
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
                          ["expiry", "actions"].includes(header.column.id)
                            ? "end"
                            : "start"
                        }
                      />
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No users match that search.
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() =>
                        navigate({
                          to: "/admin/users/$userId",
                          params: { userId: row.original.id },
                        })
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            <DataTablePagination table={table} unit="user" />
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={deleteUser !== null}
        onOpenChange={(open) => !open && setDeleteUser(null)}
        title={`Delete ${deleteUser?.name ?? "this user"}?`}
        description={
          "Their record and share link are removed. Their keys are kept and keep working — " +
          "they just stop being attached to anyone. Delete those separately from the server's keys table."
        }
        confirmLabel="Delete user"
        onConfirm={() => deleteUser && removeUser.mutate(deleteUser)}
        isPending={removeUser.isPending}
      />
    </Card>
  )
}
