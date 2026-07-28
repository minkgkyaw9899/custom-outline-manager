import { Link } from "@tanstack/react-router"
import { CompassIcon, HouseIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Root route's notFoundComponent — the whole page when nothing in the route
 * tree matches. Renders bare (no AppLayout/sidebar), so it has to stand on
 * its own rather than assume any chrome around it.
 */
export function NotFoundPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-4 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CompassIcon className="size-8" strokeWidth={1.5} aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <p className="font-heading text-sm font-semibold tracking-widest text-primary uppercase">
          404
        </p>
        <h1 className="font-heading text-2xl font-semibold text-balance sm:text-3xl">
          This page doesn't exist
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The link may be out of date, or the page may have moved. Check the
          address, or head back to the dashboard.
        </p>
      </div>
      <Button render={<Link to="/" />}>
        <HouseIcon data-icon="inline-start" />
        Back to dashboard
      </Button>
    </main>
  )
}
