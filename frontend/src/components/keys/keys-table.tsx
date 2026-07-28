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
  useReactTable
  
} from "@tanstack/react-table"
import type {SortingState} from "@tanstack/react-table";
import { GaugeIcon, KeyRoundIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { CopyButton } from "@/components/copy-button"
import { SortableHead } from "@/components/data-table-header"
import {
  DEFAULT_PAGE_SIZE,
  DataTablePagination,
} from "@/components/data-table-pagination"
import {
  KeyConnectionStatus,
  keyDisplayName,
  keyShareUrl,
  OnlineKeysBadge,
} from "@/components/keys/key-connection-status"
import { EditKeyDialog } from "@/components/keys/edit-key-dialog"
import { NewKeyDialog } from "@/components/keys/new-key-dialog"
import { OverallLimitDialog } from "@/components/keys/overall-limit-dialog"
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { apiClient } from "@/lib/api"
import {
  formatBytesCompact,
  formatDateOnly,
  formatDaysLeft,
  formatUsagePair,
} from "@/lib/format"
import { isMockId, mockDeleteKey } from "@/lib/mock-server-detail"
import type { Key, KeyMetrics, KeyStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "limit_exceeded", label: "Limit exceeded" },
  { value: "expired", label: "Expired" },
  { value: "disabled", label: "Disabled" },
]

/** A row is a key plus whatever live metrics exist for it. */
interface KeyRow {
  key: Key
  metrics: KeyMetrics | undefined
}

/** Green until three quarters spent, amber approaching the cap, red at it. */
function usageBarColor(ratio: number): string {
  if (ratio >= 1) return "bg-destructive"
  if (ratio >= 0.75) return "bg-chart-3"
  return "bg-chart-1"
}

function UsageCell({ keyItem }: Readonly<{ keyItem: Key }>) {
  const { usedBytes, customLimitBytes } = keyItem
  // An unmetered key has no bar to draw — a full-width track would read as
  // "no quota left" rather than "no quota set".
  if (customLimitBytes === null) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-xs tabular-nums">
          {formatBytesCompact(usedBytes, { decimals: 1 })}
        </span>
        <span className="text-xs text-muted-foreground">No limit</span>
      </div>
    )
  }

  const ratio = customLimitBytes === 0 ? 1 : usedBytes / customLimitBytes
  return (
    <div className="flex min-w-40 flex-col gap-1.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", usageBarColor(ratio))}
          style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {formatUsagePair(usedBytes, customLimitBytes)}
      </span>
    </div>
  )
}

function ExpiryCell({ keyItem }: Readonly<{ keyItem: Key }>) {
  const { endDate, daysLeft } = keyItem
  if (endDate === null) {
    return <span className="text-sm text-muted-foreground">No expiry</span>
  }
  const expired = daysLeft !== null && daysLeft < 0
  const soon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-mono text-xs tabular-nums">{formatDateOnly(endDate)}</span>
      <Badge
        variant="outline"
        className={cn(
          "text-[11px]",
          expired && "border-destructive/30 text-destructive",
          soon && "border-chart-3/40 text-chart-3",
        )}
      >
        {daysLeft !== null && daysLeft < 0
          ? `expired ${Math.abs(daysLeft)}d`
          : formatDaysLeft(daysLeft)}
      </Badge>
    </div>
  )
}

const columnHelper = createColumnHelper<KeyRow>()

export function KeysTable({
  serverId,
  keys,
  keyMetrics,
  onlineKeys,
  windowLabel,
  defaultLimitBytes,
}: Readonly<{
  serverId: string
  keys: Key[]
  keyMetrics: Record<string, KeyMetrics> | null
  onlineKeys: number | null | undefined
  windowLabel: string
  /** The server's default quota, driving the "overall data limit" control. */
  defaultLimitBytes: number | null
}>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [editKey, setEditKey] = useState<Key | null>(null)
  const [deleteKey, setDeleteKey] = useState<Key | null>(null)
  const [overallLimitOpen, setOverallLimitOpen] = useState(false)

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const removeKey = useMutation({
    mutationFn: (key: Key) =>
      isMockId(key.id)
        ? mockDeleteKey(key.id)
        : apiClient.delete<null>(`keys/${key.id}`),
    onSuccess: () => {
      setDeleteKey(null)
      queryClient.invalidateQueries({ queryKey: ["servers"] })
      queryClient.invalidateQueries({ queryKey: ["keys"] })
      queryClient.invalidateQueries({ queryKey: ["stats"] })
    },
  })

  const rows = useMemo<KeyRow[]>(
    () =>
      keys.map((key) => ({
        key,
        metrics: keyMetrics?.[key.outlineKeyId],
      })),
    [keys, keyMetrics],
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => row.key.name, {
        id: "name",
        header: "Key name",
        // The whole row opens the key, but the name is the real link: it keeps
        // the row reachable by keyboard without putting a link role on a <tr>.
        cell: ({ row }) => (
          <Link
            to="/admin/keys/$keyId"
            params={{ keyId: row.original.key.id }}
            className="hover:underline"
          >
            <KeyConnectionStatus
              name={row.original.key.name}
              outlineKeyId={row.original.key.outlineKeyId}
              isOnline={row.original.metrics?.isOnline ?? false}
            />
          </Link>
        ),
      }),
      columnHelper.accessor((row) => (row.key.userId ? row.key.userName || "" : ""), {
        id: "holder",
        header: "Holder",
        cell: ({ row }) =>
          row.original.key.userId ? (
            <Badge variant="secondary">
              {row.original.key.userName || "Linked"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Unassigned
            </Badge>
          ),
      }),
      columnHelper.accessor((row) => row.key.status, {
        id: "status",
        header: "Status",
        filterFn: (row, _id, value: string) =>
          value === "all" || row.original.key.status === (value as KeyStatus),
        cell: ({ row }) => <StatusBadge status={row.original.key.status} />,
      }),
      columnHelper.accessor(
        (row) =>
          row.key.customLimitBytes === null
            ? 0
            : row.key.usedBytes / Math.max(1, row.key.customLimitBytes),
        {
          id: "usage",
          header: "Usage",
          cell: ({ row }) => <UsageCell keyItem={row.original.key} />,
        },
      ),
      columnHelper.accessor((row) => row.metrics?.peakDeviceCount ?? -1, {
        id: "peakDevices",
        header: () => <span className="block text-right">Peak devices</span>,
        cell: ({ row }) => (
          <div className="text-right font-mono tabular-nums">
            {row.original.metrics?.peakDeviceCount ?? "—"}
          </div>
        ),
      }),
      columnHelper.accessor((row) => row.key.daysLeft ?? Infinity, {
        id: "expiry",
        header: () => <span className="block text-right">Expiry</span>,
        cell: ({ row }) => <ExpiryCell keyItem={row.original.key} />,
      }),
      columnHelper.display({
        id: "actions",
        header: () => <span className="block text-right">Actions</span>,
        cell: ({ row }) => (
          // The row itself opens the key, so the controls inside it have to
          // stop the click before it reaches the row.
          <div
            className="flex items-center justify-end gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <CopyButton value={keyShareUrl(row.original.key)} />
                  </span>
                }
              />
              <TooltipContent className="max-w-sm break-all" side="top">
                <span className="font-semibold">
                  {row.original.key.dynamicAccessUrl
                    ? "Dynamic link: "
                    : "Static link: "}
                </span>
                {keyShareUrl(row.original.key)}
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={`Edit ${keyDisplayName(row.original.key)}`}
              title="Edit"
              onClick={() => setEditKey(row.original.key)}
            >
              <PencilIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={`Delete ${keyDisplayName(row.original.key)}`}
              title="Delete"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteKey(row.original.key)}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
        ),
      }),
    ],
    [],
  )

  // Stable identity matters: the table auto-resets the page index whenever the
  // filter state changes, so a fresh array on every render would bounce the
  // admin back to page 1 the moment they paged forward.
  const columnFilters = useMemo(
    () => [{ id: "status", value: statusFilter }],
    [statusFilter],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CardTitle className="font-heading text-lg">
              Access keys ({keys.length})
            </CardTitle>
            <OnlineKeysBadge onlineKeys={onlineKeys} />
          </div>
          <CardDescription>
            Usage and quota come from the last sync; peak devices are live, last{" "}
            {windowLabel}. A green dot means the key moved traffic in the last 5
            minutes. Open a row for the key's full detail.
          </CardDescription>
        </div>

        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value ?? "all")
              table.setPageIndex(0)
            }}
          >
            <SelectTrigger size="sm" className="min-w-44" aria-label="Filter by status">
              <SelectValue>
                {(value: string) =>
                  `Filter: ${STATUS_FILTERS.find((f) => f.value === value)?.label ?? ""}`
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {STATUS_FILTERS.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOverallLimitOpen(true)}
            >
              <GaugeIcon data-icon="inline-start" />
              {defaultLimitBytes === null
                ? "Overall data limit"
                : `Overall limit: ${formatBytesCompact(defaultLimitBytes)}`}
            </Button>
            <NewKeyDialog serverId={serverId}>
              <Button size="sm">
                <PlusIcon data-icon="inline-start" />
                New key
              </Button>
            </NewKeyDialog>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {keys.length === 0 ? (
          <Empty className="rounded-lg border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRoundIcon />
              </EmptyMedia>
              <EmptyTitle>No access keys yet</EmptyTitle>
              <EmptyDescription>
                Create a key to hand out an Outline connection link for this server.
              </EmptyDescription>
            </EmptyHeader>
            <NewKeyDialog serverId={serverId}>
              <Button>
                <PlusIcon data-icon="inline-start" />
                New key
              </Button>
            </NewKeyDialog>
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
                          ["name", "holder", "status", "usage"].includes(
                            header.column.id,
                          )
                            ? "start"
                            : "end"
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
                      No keys match this filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    // Clicking anywhere on the row opens the key; the name cell
                    // carries the actual link for keyboard and middle-click.
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() =>
                        navigate({
                          to: "/admin/keys/$keyId",
                          params: { keyId: row.original.key.id },
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

            <DataTablePagination table={table} unit="key" />
          </>
        )}
      </CardContent>

      <EditKeyDialog
        keyItem={editKey}
        open={editKey !== null}
        onOpenChange={(isOpen) => !isOpen && setEditKey(null)}
      />

      <OverallLimitDialog
        serverId={serverId}
        defaultLimitBytes={defaultLimitBytes}
        keys={keys}
        open={overallLimitOpen}
        onOpenChange={setOverallLimitOpen}
      />

      <ConfirmDialog
        open={deleteKey !== null}
        onOpenChange={(open) => !open && setDeleteKey(null)}
        title={`Delete ${deleteKey ? keyDisplayName(deleteKey) : "this key"}?`}
        description={
          "The key is removed from the Outline server immediately and its holder loses access. " +
          "Usage history for it is deleted too. This cannot be undone."
        }
        confirmLabel="Delete key"
        onConfirm={() => deleteKey && removeKey.mutate(deleteKey)}
        isPending={removeKey.isPending}
      />
    </Card>
  )
}
