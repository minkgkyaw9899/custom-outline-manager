import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { toast } from "@/components/ui/toast"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className={cn(className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.add({ title: "Couldn't copy to clipboard", type: "error" })
        }
      }}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      <span className="sr-only">Copy</span>
    </Button>
  )
}
