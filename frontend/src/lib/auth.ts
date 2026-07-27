import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "./api"
import type { AdminUser, RequestOtpResponse, VerifyOtpResponse } from "./types"

export const authMeQueryOptions = () =>
  queryOptions({
    queryKey: ["auth", "me"] as const,
    queryFn: () => apiClient.get<AdminUser>("auth/me"),
    retry: false,
    staleTime: 60_000,
  })

export function useAuth() {
  const query = useQuery(authMeQueryOptions())
  return {
    admin: query.data,
    isLoading: query.isLoading,
    isAuthenticated: !!query.data,
  }
}

export function useRequestOtp() {
  return useMutation({
    mutationFn: (email: string) =>
      apiClient.post<RequestOtpResponse>(
        "auth/request-otp",
        { email },
        { silentToast: true },
      ),
  })
}

export function useVerifyOtp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { email: string; code: string }) =>
      apiClient.post<VerifyOtpResponse>("auth/verify-otp", vars),
    onSuccess: (data) => {
      queryClient.setQueryData(authMeQueryOptions().queryKey, data.admin)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient.post<null>("auth/logout"),
    onSuccess: () => {
      queryClient.setQueryData(authMeQueryOptions().queryKey, undefined)
      queryClient.clear()
      window.location.assign("/admin/login")
    },
  })
}
