import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"

import { ModeToggle } from "@/components/mode-toggle"
import { InvalidLinkCard, ShareAuthLayout } from "@/components/share/passcode-cards"
import { KeyStatusView } from "@/components/share/key-status-view"
import { Skeleton } from "@/components/ui/skeleton"
import { isApiError } from "@/lib/api"
import {
  clearShareToken,
  getStoredShareToken,
  shareStatusQueryOptions,
  shareViewQueryOptions,
} from "@/lib/share"

export const Route = createFileRoute("/users/keys-status/$slug")({
  component: KeyStatusPage,
})

function KeyStatusPage() {
  const { slug } = Route.useParams()
  const navigate = useNavigate()
  const [token, setToken] = useState<string | null>(
    () => getStoredShareToken(slug)?.token ?? null,
  )

  const viewQuery = useQuery(shareViewQueryOptions(slug, token))
  const statusQuery = useQuery({ ...shareStatusQueryOptions(slug), enabled: !token })

  // An expired or otherwise-rejected token falls back to the passcode screen
  // rather than getting stuck on an error — the holder still knows their
  // passcode even though the session lapsed.
  useEffect(() => {
    if (token && viewQuery.isError) {
      clearShareToken(slug)
      setToken(null)
    }
  }, [token, viewQuery.isError, slug])

  // This is the link people actually click first, so a visitor with no live
  // session lands here and gets routed to whichever passcode step is next.
  useEffect(() => {
    if (!token && statusQuery.data) {
      navigate({
        to: statusQuery.data.passcodeSet ? "/users/login/$slug" : "/users/setup/$slug",
        params: { slug },
        replace: true,
      })
    }
  }, [token, statusQuery.data, slug, navigate])

  if (token && viewQuery.data) {
    return (
      <div className="mx-auto flex min-h-svh max-w-7xl flex-col gap-6 p-6 lg:p-14">
        <div className="flex justify-end">
          <ModeToggle />
        </div>
        <KeyStatusView data={viewQuery.data} />
      </div>
    )
  }

  let body: React.ReactNode

  if (!token && statusQuery.isError) {
    const notFound =
      isApiError(statusQuery.error) &&
      statusQuery.error.apiError?.code === "NOT_FOUND"
    body = notFound ? (
      <InvalidLinkCard />
    ) : (
      <p className="text-sm text-muted-foreground">
        Something went wrong loading this link. Try reloading the page.
      </p>
    )
  } else {
    // Either the view is still loading/being retried, or we're mid-redirect
    // to setup/login — both are brief, so a skeleton is all this needs.
    body = <Skeleton className="h-64 w-full max-w-sm" />
  }

  return <ShareAuthLayout>{body}</ShareAuthLayout>
}
