import { Sparkline } from "@/components/sparkline"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"

const BADGE_TONE = {
  positive: "border-transparent bg-primary/10 text-primary",
  warning: "border-transparent bg-warning/10 text-warning",
} as const

export function StatCard({
  label,
  badge,
  badgeTone = "positive",
  value,
  valueSuffix,
  note,
  sparkline,
  highlightCount = 2,
}: Readonly<{
  label: string
  badge: string
  badgeTone?: keyof typeof BADGE_TONE
  value: string
  valueSuffix?: string
  note: string
  sparkline: number[]
  highlightCount?: number
}>) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardDescription>{label}</CardDescription>
        <Badge variant="outline" className={BADGE_TONE[badgeTone]}>
          {badge}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-heading text-4xl font-bold tracking-tight">{value}</span>
            {valueSuffix && (
              <span className="text-sm text-muted-foreground">{valueSuffix}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{note}</p>
        </div>
        <Sparkline values={sparkline} highlightCount={highlightCount} />
      </CardContent>
    </Card>
  )
}
