import { QrCodeIcon } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"

import { CopyButton } from "@/components/common/copy-button"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** A link's connection QR code, scannable by the Outline client's "scan" import. */
function LinkQrButton({
  value,
  label,
}: Readonly<{ value: string; label: string }>) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="shrink-0"
          />
        }
      >
        <QrCodeIcon className="size-3.5" />
        <span className="sr-only">Show QR code for {label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        <QRCodeSVG value={value} size={192} marginSize={2} />
      </PopoverContent>
    </Popover>
  )
}

/** One link + copy affordance, shown as its own labeled block rather than a `dl` row. */
export function KeyLinkField({
  label,
  value,
  emptyNote,
  badge,
}: Readonly<{
  label: string
  value: string
  emptyNote?: string
  /** Extra content next to the label — e.g. a "Recommended" badge. */
  badge?: React.ReactNode
}>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {label}
        {badge}
      </span>
      {value ? (
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <code className="min-w-0 flex-1 cursor-default truncate rounded-md bg-muted px-3 py-2 font-mono text-xs" />
              }
            >
              {value}
            </TooltipTrigger>
            <TooltipContent className="max-w-sm break-all" side="top">
              {value}
            </TooltipContent>
          </Tooltip>
          <LinkQrButton value={value} label={label} />
          <CopyButton value={value} className="shrink-0" />
        </div>
      ) : (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {emptyNote}
        </p>
      )}
    </div>
  )
}
