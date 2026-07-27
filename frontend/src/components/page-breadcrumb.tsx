import { Fragment } from "react"
import { Link, useParams, useRouterState } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { HomeIcon } from "lucide-react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { keyDisplayName } from "@/components/keys/key-connection-status"
import { isMockId, mockServerDetail } from "@/lib/mock-server-detail"
import {
  keyDetailQueryOptions,
  serverDetailQueryOptions,
  userDetailQueryOptions,
} from "@/lib/queries"

interface Crumb {
  label: string
  to?: string
  params?: Record<string, string>
}

/**
 * Server and key names aren't known from the URL alone, so this reads the
 * same TanStack Query cache the detail pages populate — no extra fetch, just
 * a subscription that resolves once those pages have loaded.
 */
function useCrumbs(): Crumb[] {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { serverId, keyId, userId } = useParams({ strict: false })

  const server = useQuery({
    ...serverDetailQueryOptions(serverId ?? ""),
    ...(serverId && isMockId(serverId) ? { queryFn: mockServerDetail } : {}),
    enabled: !!serverId,
  })
  const key = useQuery({
    ...keyDetailQueryOptions(keyId ?? ""),
    ...(keyId && isMockId(keyId)
      ? {
          queryFn: async () => {
            const detail = await mockServerDetail()
            const found = detail.keys.find((k) => k.id === keyId)
            if (!found) throw new Error("Key not found")
            return found
          },
        }
      : {}),
    enabled: !!keyId,
  })
  const user = useQuery({
    ...userDetailQueryOptions(userId ?? ""),
    enabled: !!userId,
  })
  const keyServerId = key.data?.serverId
  const keyServer = useQuery({
    ...serverDetailQueryOptions(keyServerId ?? ""),
    ...(keyServerId && isMockId(keyServerId) ? { queryFn: mockServerDetail } : {}),
    enabled: !!keyServerId,
  })

  const crumbs: Crumb[] = [{ label: "Dashboard", to: "/admin/overview" }]

  if (pathname.startsWith("/admin/servers")) {
    crumbs.push({ label: "Servers", to: "/admin/servers" })
    if (serverId) {
      crumbs.push({ label: server.data?.server.name ?? "Server" })
    }
  } else if (keyId) {
    crumbs.push({ label: "Servers", to: "/admin/servers" })
    if (key.data) {
      crumbs.push({
        label: keyServer.data?.server.name ?? "Server",
        to: "/admin/servers/$serverId",
        params: { serverId: key.data.serverId },
      })
    }
    crumbs.push({ label: key.data ? keyDisplayName(key.data) : "Key" })
  } else if (pathname.startsWith("/admin/revenue")) {
    crumbs.push({ label: "Revenue" })
  } else if (pathname.startsWith("/admin/users")) {
    crumbs.push({ label: "Users", to: "/admin/users" })
    if (userId) {
      crumbs.push({ label: user.data?.name ?? "User" })
    }
  }

  return crumbs
}

export function PageBreadcrumb() {
  const crumbs = useCrumbs()

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <Fragment key={index}>
              <BreadcrumbItem>
                {crumb.to && !isLast ? (
                  <BreadcrumbLink
                    render={
                      <Link to={crumb.to} params={crumb.params}>
                        {index === 0 && (
                          <HomeIcon className="mr-1 inline size-3.5 align-[-2px]" />
                        )}
                        {crumb.label}
                      </Link>
                    }
                  />
                ) : (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
