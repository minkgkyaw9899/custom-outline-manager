import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react"
import type { Table } from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** Every table on this dashboard shows ten rows before paging. */
export const DEFAULT_PAGE_SIZE = 10

const PAGE_SIZE_OPTIONS = [10, 20, 30, 60, 100]

/**
 * Footer controls shared by the keys and AS tables: a row range on the left,
 * page position and first/prev/next/last on the right.
 *
 * `unit` is the singular noun for the rows, e.g. "key" → "1–10 of 12 keys".
 * Pass `unitPlural` when adding an "s" would not do ("AS" → "ASes").
 */
export function DataTablePagination<TData>({
  table,
  unit,
  unitPlural,
}: Readonly<{ table: Table<TData>; unit: string; unitPlural?: string }>) {
  const total = table.getFilteredRowModel().rows.length
  const { pageIndex, pageSize } = table.getState().pagination
  const firstRow = total === 0 ? 0 : pageIndex * pageSize + 1
  const lastRow = Math.min(total, (pageIndex + 1) * pageSize)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground tabular-nums">
        {firstRow}–{lastRow} of {total}{" "}
        {total === 1 ? unit : (unitPlural ?? `${unit}s`)}
      </p>
      <div className="flex items-center gap-3">
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            table.setPageSize(Number(value))
            table.setPageIndex(0)
          }}
        >
          <SelectTrigger size="sm" className="min-w-28" aria-label="Rows per page">
            <SelectValue>
              {(value: string) => `${value} / page`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} / page
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground tabular-nums">
          Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="First page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.setPageIndex(0)}
          >
            <ChevronsLeftIcon className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeftIcon className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRightIcon className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Last page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          >
            <ChevronsRightIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
