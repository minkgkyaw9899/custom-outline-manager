import { useEffect } from "react"
import { Link } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { HouseIcon, RefreshCwIcon, ServerCrashIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Root route's errorComponent — replaces TanStack Router's built-in
 * ErrorComponent, which is unstyled and (worse) puts a "Show Error" toggle
 * in front of the admin that reveals the raw thrown error — for an API
 * failure that's often literally the backend's JSON error body. Logged to
 * the console for debugging instead; nothing about the error is ever
 * rendered into the page itself, in dev or production.
 */
export function ErrorPage({ error, reset }: Readonly<ErrorComponentProps>) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-4 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ServerCrashIcon className="size-8" strokeWidth={1.5} aria-hidden />
      </span>
      <div className="flex flex-col gap-2">
        <p className="font-heading text-sm font-semibold tracking-widest text-destructive uppercase">
          500
        </p>
        <h1 className="font-heading text-2xl font-semibold text-balance sm:text-3xl">
          Something went wrong
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This page hit an unexpected error. Try again, or head back to the
          dashboard — if it keeps happening, let an admin know.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={reset}>
          <RefreshCwIcon data-icon="inline-start" />
          Try again
        </Button>
        <Button render={<Link to="/" />}>
          <HouseIcon data-icon="inline-start" />
          Back to dashboard
        </Button>
      </div>
    </main>
  )
}
