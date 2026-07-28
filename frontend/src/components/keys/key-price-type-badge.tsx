import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { KeyPriceType } from "@/lib/key-price-type"

const LABEL: Record<KeyPriceType, string> = {
  paid: "Paid",
  free: "Free",
  unpriced: "Unpriced",
}

const STYLES: Record<KeyPriceType, string> = {
  paid: "border-transparent bg-primary/10 text-primary",
  free: "border-transparent bg-muted text-muted-foreground",
  unpriced: "border-transparent bg-warning/10 text-warning",
}

export function KeyPriceTypeBadge({
  type,
  className,
}: Readonly<{ type: KeyPriceType; className?: string }>) {
  return (
    <Badge variant="outline" className={cn(STYLES[type], className)}>
      {LABEL[type]}
    </Badge>
  )
}
