import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"

/** A single headline figure, used on both the admin and public key detail pages. */
export function StatCard({
  label,
  value,
  note,
}: Readonly<{ label: string; value: string; note?: string }>) {
  return (
    <Card className="gap-1 py-3 md:gap-(--card-spacing) md:py-(--card-spacing)">
      <CardHeader className="gap-0.5 px-3 md:gap-1.5 md:px-(--card-spacing)">
        <CardDescription className="truncate text-[11px] md:text-sm">
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-3 md:px-(--card-spacing)">
        <div className="truncate font-heading text-base font-bold tracking-tight md:text-3xl">
          {value}
        </div>
        {note && (
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground md:mt-1 md:text-sm">
            {note}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
