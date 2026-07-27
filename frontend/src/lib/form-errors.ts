import { isApiError } from "./api"
import type { ApiErrorDetail } from "./types"

// Field-name -> message, for forms held in plain component state rather than a
// TanStack Form instance. A global (non-field) error is surfaced as a toast by
// the ky hook in api.ts, so it is deliberately dropped here.
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!isApiError(error) || !error.apiError?.details) return {}
  return Object.fromEntries(
    error.apiError.details.map((d) => [d.field, d.message]),
  )
}

// Binds server-side `error.details` (field names are just strings on the
// wire, decided by the backend) onto a TanStack Form instance. The meta
// shape is intentionally untyped here — TanStack Form ties it to each
// field's validator generics, which we don't define, so fighting that type
// buys nothing. The cast to TField bridges the runtime string field name to
// the form's statically-known field union.
export function applyServerFieldErrors<TField extends string>(
  form: { setFieldMeta: (field: TField, updater: (prev: any) => any) => void },
  details: ApiErrorDetail[],
) {
  for (const detail of details) {
    form.setFieldMeta(detail.field as TField, (prev) => ({
      ...prev,
      errorMap: { ...prev.errorMap, onSubmit: detail.message },
      errors: [detail.message],
    }))
  }
}
