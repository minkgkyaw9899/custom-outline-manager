import { useEffect } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"

import {
  InvalidLinkCard,
  ShareAuthLayout,
  VerifyCard,
} from "@/components/share/passcode-cards"
import { Skeleton } from "@/components/ui/skeleton"
import { isApiError } from "@/lib/api"
import {
  getStoredShareToken,
  shareStatusQueryOptions,
  storeShareToken,
} from "@/lib/share"

export const Route = createFileRoute("/users/login/$slug")({
  component: LoginPage,
})

function LoginPage() {
  const { slug } = Route.useParams()
  const navigate = useNavigate()

  const statusQuery = useQuery(shareStatusQueryOptions(slug))

  // Already signed in? Nothing to log in for — go straight to the key.
  useEffect(() => {
    if (getStoredShareToken(slug)) {
      navigate({
        to: "/users/keys-status/$slug",
        params: { slug },
        replace: true,
      })
    }
  }, [slug, navigate])

  // Never set up? Login isn't the right page yet — go set up a passcode first.
  useEffect(() => {
    if (statusQuery.data && !statusQuery.data.passcodeSet) {
      navigate({ to: "/users/setup/$slug", params: { slug }, replace: true })
    }
  }, [statusQuery.data, slug, navigate])

  const handleSignedIn = (token: string, expiresAt: string) => {
    storeShareToken(slug, token, expiresAt)
    navigate({ to: "/users/keys-status/$slug", params: { slug } })
  }

  let body: React.ReactNode

  if (statusQuery.isLoading) {
    body = <Skeleton className="h-64 w-full max-w-sm" />
  } else if (statusQuery.isError) {
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
  } else if (statusQuery.data && !statusQuery.data.passcodeSet) {
    // Redirecting to /users/setup — this only flashes for a moment.
    body = <Skeleton className="h-64 w-full max-w-sm" />
  } else {
    body = <VerifyCard slug={slug} onSignedIn={handleSignedIn} />
  }

  return <ShareAuthLayout>{body}</ShareAuthLayout>
}
