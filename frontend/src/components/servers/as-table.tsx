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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatBytesCompact, formatHours } from "@/lib/format"
import type { ASUsage } from "@/lib/types"

const columnHelper = createColumnHelper<ASUsage>()

/**
 * "ASes with most bandwidth usage" — Outline's own framing of what the design
 * called top operators. Sorted by share on arrival, since the question this
 * answers is "who is using this server the most".
 */
export function AsTable({
  ases,
  windowLabel,
}: Readonly<{ ases: ASUsage[]; windowLabel: string }>) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "bandwidth", desc: true },
  ])

  const columns = useMemo(
    () => [
      columnHelper.accessor((as) => as.asOrg, {
        id: "as",
        header: "AS",
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{row.original.asOrg}</span>
            <span className="font-mono text-xs text-muted-foreground">
              AS{row.original.asn}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor((as) => as.bytesTransferred, {
        id: "bandwidth",
        header: () => <span className="block text-right">Bandwidth</span>,
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">
            {formatBytesCompact(row.original.bytesTransferred, { decimals: 2 })}
          </div>
        ),
      }),
      columnHelper.accessor((as) => as.tunnelTimeHours, {
        id: "tunnelTime",
        header: () => <span className="block text-right">Tunnel time</span>,
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">
            {formatHours(row.original.tunnelTimeHours)}
          </div>
        ),
      }),
    ],
    []
  )

  const table = useReactTable({
    data: ases,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: DEFAULT_PAGE_SIZE } },
    // See keys-table.tsx: without this, a refetch's new array reference
    // would snap the table back to page 1 even when nothing that should
    // affect paging changed.
    autoResetPageIndex: false,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">
          ASes with most bandwidth usage
        </CardTitle>
        <CardDescription>
          Autonomous systems this server saw traffic from, last {windowLabel}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {ases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No AS traffic reported in this window.
          </p>
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
                        align={header.column.id === "as" ? "start" : "end"}
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
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination table={table} unit="AS" unitPlural="ASes" />
          </>
        )}
      </CardContent>
    </Card>
  )
}
