import { CopyButton } from "@/components/copy-button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** One link + copy affordance, shown as its own labeled block rather than a `dl` row. */
export function KeyLinkField({
  label,
  value,
  emptyNote,
}: Readonly<{ label: string; value: string; emptyNote?: string }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
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
