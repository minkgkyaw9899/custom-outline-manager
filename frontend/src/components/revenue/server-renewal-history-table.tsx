import { useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
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
import { formatDate, formatMmk } from "@/lib/format"
import type { RenewalLog } from "@/lib/types"

const columnHelper = createColumnHelper<RenewalLog>()

/** "20 GB · 30d", or "Set manually" for a plain limit/expiry correction that added nothing. */
function planLabel(renewal: RenewalLog): string {
  if (renewal.addedGb === 0 && renewal.addedDays === 0) return "Set manually"
  return `${renewal.addedGb} GB · ${renewal.addedDays}d`
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
  columnHelper.accessor((row) => row.userName || "", {
    id: "user",
    header: "User",
    cell: ({ getValue }) =>
      getValue() ? (
        <Badge variant="secondary">{getValue()}</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          Unassigned
        </Badge>
      ),
  }),
  columnHelper.accessor((row) => row.keyName || "", {
    id: "key",
    header: "Key",
    cell: ({ row }) => (
      <Link
        to="/admin/keys/$keyId"
        params={{ keyId: row.original.keyId }}
        className="hover:underline"
      >
        {row.original.keyName || row.original.keyId}
      </Link>
    ),
  }),
  columnHelper.display({
    id: "plan",
    header: () => <span className="block text-right">Plan</span>,
    cell: ({ row }) => (
      <div className="text-right font-mono text-xs tabular-nums text-muted-foreground">
        {planLabel(row.original)}
      </div>
    ),
  }),
  columnHelper.accessor((row) => row.amountMmk ?? -1, {
    id: "amount",
    header: () => <span className="block text-right">Incoming amount</span>,
    cell: ({ row }) => (
      <div className="text-right font-mono tabular-nums">
        {row.original.amountMmk === null
          ? "—"
          : formatMmk(row.original.amountMmk)}
      </div>
    ),
  }),
  columnHelper.accessor("paid", {
    header: "Payment",
    cell: ({ row }) => (
      <Badge variant={row.original.paid ? "secondary" : "destructive"}>
        {row.original.paid ? "Paid" : "Unpaid"}
      </Badge>
    ),
  }),
]

/**
 * The revenue detail page's per-renewal breakdown: every manual extend and
 * auto-renew logged for any key on this server, newest first — what actually
 * came in and when, alongside the level-based monthly breakdown above it.
 */
export function ServerRenewalHistoryTable({
  renewals,
  isLoading,
}: Readonly<{
  renewals: RenewalLog[] | undefined
  isLoading: boolean
}>) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "date", desc: true },
  ])

  const rows = useMemo(() => renewals ?? [], [renewals])

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
        No key on this server has been renewed yet — manual extends and
        auto-renews will show up here as they happen.
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
                      ["date", "user", "key"].includes(header.column.id)
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
        <DataTablePagination table={table} unit="renewal" />
      </>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">
          Renewal history
        </CardTitle>
        <CardDescription>
          Every manual extend and auto-renew on this server's keys, newest
          first, with what each one was worth at the time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{content}</CardContent>
    </Card>
  )
}
