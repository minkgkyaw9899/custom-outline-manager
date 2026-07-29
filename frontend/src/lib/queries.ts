import { queryOptions, useQuery } from "@tanstack/react-query"
import { apiClient } from "./api"
import type {
  AdminUser,
  AppSettings,
  DashboardStats,
  Key,
  KeyUsageSeries,
  MetricsWindow,
  Order,
  OrderStatus,
  PublicPaymentInfo,
  PublicServer,
  RenewalLog,
  RetentionMetrics,
  ServerDetail,
  ServerUsage,
  ServerWithUsage,
  UserWithKeys,
} from "./types"

export const adminsQueryOptions = () =>
  queryOptions({
    queryKey: ["admins"] as const,
    queryFn: () => apiClient.get<AdminUser[]>("admins"),
  })

export const usersQueryOptions = () =>
  queryOptions({
    queryKey: ["users"] as const,
    queryFn: () => apiClient.get<UserWithKeys[]>("users"),
  })

export const userDetailQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ["users", userId] as const,
    queryFn: () => apiClient.get<UserWithKeys>(`users/${userId}`),
  })

/**
 * Keys not yet linked to any holder — what the "link an existing key" picker
 * offers. Every key adopted from an Outline server starts here.
 */
export const unassignedKeysQueryOptions = () =>
  queryOptions({
    queryKey: ["keys", { unassigned: true }] as const,
    queryFn: () => apiClient.get<Key[]>("keys", { unassigned: "true" }),
  })

/** Every key across every server, holder-linked or not — feeds the Overview dashboard. */
export const keysQueryOptions = () =>
  queryOptions({
    queryKey: ["keys"] as const,
    queryFn: () => apiClient.get<Key[]>("keys"),
  })

// Live metrics come from the Outline servers themselves on every request, so
// these are deliberately short-lived: the bandwidth figure is a current rate
// and goes stale within seconds, unlike the DB-backed counts alongside it.
const LIVE_METRICS_STALE_MS = 15_000

/**
 * How often live server data refreshes while the admin is at the keyboard.
 *
 * Callers pass `refetchInterval: isActive ? LIVE_REFRESH_MS : false` (see
 * useIsUserActive) so an idle or backgrounded dashboard stops polling the
 * Outline servers entirely.
 */
export const LIVE_REFRESH_MS = 60_000

export const serversQueryOptions = (window: MetricsWindow = "30d") =>
  queryOptions({
    queryKey: ["servers", { window }] as const,
    queryFn: () => apiClient.get<ServerWithUsage[]>("servers", { window }),
    staleTime: LIVE_METRICS_STALE_MS,
    // Belt and braces alongside the idle gate: never poll a hidden tab, and
    // catch up immediately when the admin comes back to it.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

export const serverDetailQueryOptions = (
  serverId: string,
  window: MetricsWindow = "30d",
) =>
  queryOptions({
    queryKey: ["servers", serverId, { window }] as const,
    queryFn: () =>
      apiClient.get<ServerDetail>(`servers/${serverId}`, { window }),
    staleTime: LIVE_METRICS_STALE_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

export const serverUsageQueryOptions = (serverId: string, from?: string, to?: string) =>
  queryOptions({
    queryKey: ["servers", serverId, "usage", from ?? null, to ?? null] as const,
    queryFn: () =>
      apiClient.get<ServerUsage>(
        `servers/${serverId}/usage`,
        Object.fromEntries(
          Object.entries({ from, to }).filter(([, v]) => v !== undefined),
        ) as Record<string, string>,
      ),
  })

export const keyDetailQueryOptions = (keyId: string) =>
  queryOptions({
    queryKey: ["keys", keyId] as const,
    queryFn: () => apiClient.get<Key>(`keys/${keyId}`),
  })

export const keyRenewalsQueryOptions = (keyId: string) =>
  queryOptions({
    queryKey: ["keys", keyId, "renewals"] as const,
    queryFn: () => apiClient.get<RenewalLog[]>(`keys/${keyId}/renewals`),
  })

export const keyDailyQueryOptions = (keyId: string) =>
  queryOptions({
    queryKey: ["keys", keyId, "daily"] as const,
    queryFn: () => apiClient.get<KeyUsageSeries>(`keys/${keyId}/daily`),
  })

export const statsQueryOptions = () =>
  queryOptions({
    queryKey: ["stats"] as const,
    queryFn: () => apiClient.get<DashboardStats>("stats"),
  })

/** MMK/USD rate + payment instructions — the admin-only, full settings row. */
export const settingsQueryOptions = () =>
  queryOptions({
    queryKey: ["settings"] as const,
    queryFn: () => apiClient.get<AppSettings>("settings"),
  })

/** Payment instructions only, fetched by the public /order page. */
export const publicPaymentInfoQueryOptions = () =>
  queryOptions({
    queryKey: ["settings", "public"] as const,
    queryFn: () => apiClient.get<PublicPaymentInfo>("settings/public"),
  })

/** Name-only server list for the public order page — never the protected /servers. */
export const publicServersQueryOptions = () =>
  queryOptions({
    queryKey: ["servers", "public"] as const,
    queryFn: () => apiClient.get<PublicServer[]>("servers/public"),
  })

export const ordersQueryOptions = (status?: OrderStatus) =>
  queryOptions({
    queryKey: ["orders", { status: status ?? null }] as const,
    queryFn: () =>
      apiClient.get<Order[]>("orders", status ? { status } : undefined),
  })

export const retentionQueryOptions = (days = 30) =>
  queryOptions({
    queryKey: ["analytics", "retention", { days }] as const,
    queryFn: () =>
      apiClient.get<RetentionMetrics>("analytics/retention", { days: String(days) }),
  })

/** Fallback while /settings is still loading — matches the old hardcoded constant. */
const DEFAULT_MMK_PER_USD = 4500

/**
 * The admin-editable USD→MMK rate, replacing the old hardcoded MMK_PER_USD
 * constant. Used anywhere a server's cost_usd_per_month needs converting to
 * MMK for profit math (Revenue pages, Overview, the add/edit server dialogs).
 */
export const useMmkPerUsd = () => {
  const { data } = useQuery(settingsQueryOptions())
  return data?.mmkPerUsd ?? DEFAULT_MMK_PER_USD
}
