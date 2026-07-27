export function ChartLegendDot({
  color,
  label,
}: Readonly<{ color: string; label: string }>) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-xs"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}
