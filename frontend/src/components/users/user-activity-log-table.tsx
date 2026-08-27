import { useMemo, useState } from "react"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import type { SortingState } from "@tanstack/react-table"

import { SortableHead } from "@/components/common/data-table-header"
import {
  DEFAULT_PAGE_SIZE,
  DataTablePagination,
} from "@/components/common/data-table-pagination"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/lib/format"
import type { ActivityLogEntry } from "@/lib/types"

const columnHelper = createColumnHelper<ActivityLogEntry>()

/** Machine action_type -> readable label for the activity log table. */
const ACTION_LABELS: Record<string, string> = {
  user_created: "User created",
  user_edited: "User edited",
  primary_key_set: "Primary key changed",
  key_changed: "Key changed",
  usage_reset: "Usage reset",
  key_linked: "Key linked",
  key_unlinked: "Key unlinked",
  plan_edit: "Plan edited",
  auto_renew_toggle: "Auto-renew toggled",
  manual_renew: "Manually renewed",
  auto_renew: "Auto-renewed",
}

function actionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] ?? actionType
}

const columns = [
  columnHelper.accessor("createdAt", {
    id: "date",
    header: "Date",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs tabular-nums">
        {formatDate(getValue())}
      </span>
    ),
  }),
  columnHelper.accessor((row) => actionLabel(row.actionType), {
    id: "action",
    header: "Action",
    cell: ({ getValue }) => <Badge variant="secondary">{getValue()}</Badge>,
  }),
  columnHelper.accessor("detail", {
    id: "detail",
    header: "Detail",
    cell: ({ getValue }) => (
      <span className="text-sm">{getValue() || "—"}</span>
    ),
  }),
  columnHelper.accessor((row) => row.actorEmail ?? "", {
    id: "admin",
    header: "Admin",
    cell: ({ getValue }) =>
      getValue() ? (
        <span className="text-sm">{getValue()}</span>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          Auto-renew
        </Badge>
      ),
  }),
]

/**
 * The user detail page's audit trail: every renewal, plan edit, key swap,
 * and profile change logged against this user, newest first — who changed
 * what and when, without having to query the database.
 */
export function UserActivityLogTable({
  entries,
  isLoading,
}: Readonly<{
  entries: ActivityLogEntry[] | undefined
  isLoading: boolean
}>) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "date", desc: true },
  ])
  const rows = useMemo(() => entries ?? [], [entries])
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: DEFAULT_PAGE_SIZE } },
    autoResetPageIndex: false,
  })

  let content: React.ReactNode
  if (isLoading) {
    content = <Skeleton className="h-24" />
  } else if (rows.length === 0) {
    content = (
      <p className="text-sm text-muted-foreground">
        Nothing logged yet — renewals, plan edits, and key changes will show up
        here as they happen.
      </p>
    )
  } else {
    content = (
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
                      ["date", "action", "detail"].includes(header.column.id)
                        ? "start"
                        : "end"
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
        <DataTablePagination table={table} unit="entry" />
      </>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity log</CardTitle>
        <CardDescription>
          Renewals, plan edits, key changes, and profile updates for this user.
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
