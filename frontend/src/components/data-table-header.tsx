import { ArrowUpDownIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { flexRender  } from "@tanstack/react-table"
import type {Header} from "@tanstack/react-table";

import { TableHead } from "@/components/ui/table"

/**
 * A header cell that carries the sort affordance when its column is sortable,
 * and renders plain otherwise (the actions column has nothing to sort by).
 *
 * `align` follows the cells underneath: numeric columns are right-aligned, so
 * their header and sort chevron have to be too.
 */
export function SortableHead<TData, TValue>({
  header,
  align = "start",
}: Readonly<{ header: Header<TData, TValue>; align?: "start" | "end" }>) {
  const content = flexRender(header.column.columnDef.header, header.getContext())
  if (!header.column.getCanSort()) return <TableHead>{content}</TableHead>

  const sorted = header.column.getIsSorted()
  return (
    <TableHead>
      <button
        type="button"
        className={`flex w-full items-center gap-1 uppercase hover:text-foreground ${
          align === "end" ? "justify-end" : ""
        }`}
        onClick={header.column.getToggleSortingHandler()}
      >
        {content}
        {sorted === "asc" ? (
          <ChevronUpIcon className="size-3" />
        ) : sorted === "desc" ? (
          <ChevronDownIcon className="size-3" />
        ) : (
          <ArrowUpDownIcon className="size-3 opacity-40" />
        )}
      </button>
    </TableHead>
  )
}
