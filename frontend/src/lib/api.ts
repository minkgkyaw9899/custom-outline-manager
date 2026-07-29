import ky, { HTTPError, isHTTPError } from "ky"
import { toast } from "@/components/ui/toast"
import type { ApiError, ApiFailure, ApiSuccess } from "./types"

export type ApiHTTPError = HTTPError & { apiError?: ApiError }

const PUBLIC_PATHS = ["/admin/login", "/admin/verify-otp", "/order"]

// The whole /users/... side (setup, login, keys-status) is public and
// path-dynamic (per-slug), so it can't live in the exact-match PUBLIC_PATHS
// list above.
const isPublicPath = (pathname: string) =>
  PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/users/")

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "/api/v1"

export const api = ky.create({
  baseUrl: apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`,
  credentials: "include",
  timeout: 30_000,
  retry: 0,
  hooks: {
    afterResponse: [
      async ({ options, response }) => {
        if (options.context.silentToast) return response
        const body = (await response
          .clone()
          .json()
          .catch(() => null)) as ApiSuccess<unknown> | null
        if (body?.success && body.message)
          toast.add({ title: body.message, type: "success" })
        return response
      },
    ],
    beforeError: [
      ({ options, error }) => {
        if (isHTTPError(error)) {
          const body = error.data as ApiFailure | undefined
          if (body?.error) {
            const apiHttpError = error as ApiHTTPError
            apiHttpError.apiError = body.error
            if (!body.error.details?.length && !options.context.silentToast)
              toast.add({ title: body.error.message, type: "error" })
            if (
              body.error.code === "UNAUTHORIZED" &&
              !isPublicPath(window.location.pathname)
            ) {
              window.location.assign("/admin/login")
            }
          }
        }
        return error
      },
    ],
  },
})

async function unwrap<T>(promise: Promise<Response>): Promise<T> {
  const response = await promise
  const body = (await response.json()) as ApiSuccess<T>
  return body.data
}

export const apiClient = {
  get: <T>(
    url: string,
    searchParams?: Record<string, string>,
    opts?: { headers?: Record<string, string> }
  ): Promise<T> =>
    unwrap<T>(api.get(url, { searchParams, headers: opts?.headers })),
  post: <T>(
    url: string,
    json?: unknown,
    opts?: { silentToast?: boolean }
  ): Promise<T> =>
    unwrap<T>(
      api.post(url, {
        ...(json === undefined ? {} : { json }),
        ...(opts?.silentToast ? { context: { silentToast: true } } : {}),
      })
    ),
  patch: <T>(url: string, json?: unknown): Promise<T> =>
    unwrap<T>(api.patch(url, json === undefined ? {} : { json })),
  delete: <T>(url: string, searchParams?: Record<string, string>): Promise<T> =>
    unwrap<T>(api.delete(url, { searchParams })),
}

export function isApiError(error: unknown): error is ApiHTTPError {
  return error instanceof HTTPError
}
