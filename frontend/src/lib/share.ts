import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { apiClient } from "./api"
import type { ShareKeyView, ShareTokenResponse, UserShare } from "./types"

// --- Session token storage -------------------------------------------------
// The share-view session lives in localStorage, keyed by slug, rather than a
// cookie: this is a separate public visitor session (no admin auth), and a
// cookie would need path-scoping per dynamic slug for no real benefit.

interface StoredShareToken {
  token: string
  expiresAt: string
}

const storageKey = (slug: string) => `share_token_${slug}`

export function getStoredShareToken(slug: string): StoredShareToken | null {
  const raw = localStorage.getItem(storageKey(slug))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredShareToken
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(storageKey(slug))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function storeShareToken(
  slug: string,
  token: string,
  expiresAt: string
) {
  localStorage.setItem(storageKey(slug), JSON.stringify({ token, expiresAt }))
}

export function clearShareToken(slug: string) {
  localStorage.removeItem(storageKey(slug))
}

// --- Admin side (protected) -------------------------------------------------

// POST get-or-creates the link, so it's safe to drive from a query that fires
// whenever the share dialog is open — no separate "create" step needed.
//
// Scoped to the user, not the key: re-provisioning someone onto a different
// server keeps both the URL they were given and the passcode they set.
export const userShareQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ["users", userId, "share"] as const,
    queryFn: () => apiClient.post<UserShare>(`users/${userId}/share`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

export function useUserShare(userId: string, enabled: boolean) {
  return useQuery({ ...userShareQueryOptions(userId), enabled })
}

export function useResetUserShare(userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient.post<null>(`users/${userId}/share/reset`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", userId, "share"] })
    },
  })
}

// --- Public side (unauthenticated visitor) ----------------------------------

export const shareStatusQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["share", slug, "status"] as const,
    queryFn: () => apiClient.get<UserShare>(`share/${slug}/status`),
    retry: false,
  })

export function useShareStatus(slug: string) {
  return useQuery(shareStatusQueryOptions(slug))
}

export function useShareSetup(slug: string) {
  return useMutation({
    mutationFn: (code: string) =>
      apiClient.post<ShareTokenResponse>(`share/${slug}/setup`, { code }),
  })
}

export function useShareVerify(slug: string) {
  return useMutation({
    mutationFn: (code: string) =>
      apiClient.post<ShareTokenResponse>(`share/${slug}/verify`, { code }),
  })
}

export const shareViewQueryOptions = (slug: string, token: string | null) =>
  queryOptions({
    queryKey: ["share", slug, "view"] as const,
    queryFn: () =>
      apiClient.get<ShareKeyView>(`share/${slug}/view`, undefined, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    enabled: !!token,
    retry: false,
  })
