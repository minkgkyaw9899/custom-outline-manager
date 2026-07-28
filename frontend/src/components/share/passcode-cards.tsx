import { useForm } from "@tanstack/react-form"

import { AuthLayout } from "@/components/auth-layout"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Spinner } from "@/components/ui/spinner"
import { isApiError } from "@/lib/api"
import { applyServerFieldErrors } from "@/lib/form-errors"
import { useShareSetup, useShareVerify } from "@/lib/share"

/** Shared chrome for every /users/... page: same badge/heading across setup, login and view. */
export function ShareAuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthLayout
      badge="Key status"
      heading="Check your key, anytime."
      description="View your data usage, connection details and quota — no dashboard login needed."
    >
      {children}
    </AuthLayout>
  )
}

export function OtpSlots() {
  return (
    <InputOTPGroup className="w-full justify-between gap-2">
      {Array.from({ length: 6 }, (_, index) => (
        <InputOTPSlot key={index} index={index} className="h-12 flex-1 text-lg" />
      ))}
    </InputOTPGroup>
  )
}

export function SetupCard({
  slug,
  onSignedIn,
}: Readonly<{
  slug: string
  onSignedIn: (token: string, expiresAt: string) => void
}>) {
  const setup = useShareSetup(slug)

  const form = useForm({
    defaultValues: { code: "", confirmCode: "" },
    onSubmit: async ({ value }) => {
      if (value.code !== value.confirmCode) {
        form.setFieldMeta("confirmCode", (prev) => ({
          ...prev,
          errorMap: { ...prev.errorMap, onSubmit: "Codes don't match" },
          errors: ["Codes don't match"],
        }))
        return
      }
      try {
        const res = await setup.mutateAsync(value.code)
        onSignedIn(res.token, res.expiresAt)
      } catch (error) {
        if (isApiError(error) && error.apiError?.details?.length) {
          applyServerFieldErrors(form, error.apiError.details)
        }
      }
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-3xl font-bold tracking-tight normal-case">
          Set up your passcode
        </CardTitle>
        <CardDescription>
          This is your first time here. Pick a 6-digit passcode — you'll enter
          it again each time you come back to check your key.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            form.handleSubmit()
          }}
        >
          <FieldGroup>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <>
                  <form.Field name="code">
                    {(field) => {
                      const invalid = field.state.meta.errors.length > 0
                      return (
                        <Field data-invalid={invalid || undefined}>
                          <InputOTP
                            id={field.name}
                            maxLength={6}
                            autoFocus
                            disabled={isSubmitting}
                            aria-invalid={invalid || undefined}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(value) => field.handleChange(value)}
                            containerClassName="w-full"
                          >
                            <OtpSlots />
                          </InputOTP>
                          {invalid && (
                            <FieldError>
                              {String(field.state.meta.errors[0])}
                            </FieldError>
                          )}
                        </Field>
                      )
                    }}
                  </form.Field>
                  <form.Field name="confirmCode">
                    {(field) => {
                      const invalid = field.state.meta.errors.length > 0
                      return (
                        <Field data-invalid={invalid || undefined}>
                          <FieldLabel htmlFor={field.name}>
                            Confirm passcode
                          </FieldLabel>
                          <InputOTP
                            id={field.name}
                            maxLength={6}
                            disabled={isSubmitting}
                            aria-invalid={invalid || undefined}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(value) => field.handleChange(value)}
                            containerClassName="w-full"
                          >
                            <OtpSlots />
                          </InputOTP>
                          {invalid && (
                            <FieldError>
                              {String(field.state.meta.errors[0])}
                            </FieldError>
                          )}
                        </Field>
                      )
                    }}
                  </form.Field>
                  <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
                    {isSubmitting && <Spinner data-icon="inline-start" />}
                    {isSubmitting ? "Setting up" : "Set passcode"}
                  </Button>
                </>
              )}
            </form.Subscribe>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

export function VerifyCard({
  slug,
  onSignedIn,
}: Readonly<{
  slug: string
  onSignedIn: (token: string, expiresAt: string) => void
}>) {
  const verify = useShareVerify(slug)

  const form = useForm({
    defaultValues: { code: "" },
    onSubmit: async ({ value }) => {
      try {
        const res = await verify.mutateAsync(value.code)
        onSignedIn(res.token, res.expiresAt)
      } catch (error) {
        if (isApiError(error) && error.apiError?.details?.length) {
          applyServerFieldErrors(form, error.apiError.details)
        } else if (isApiError(error) && error.apiError) {
          const message = error.apiError.message
          form.setFieldMeta("code", (prev) => ({
            ...prev,
            errorMap: { ...prev.errorMap, onSubmit: message },
            errors: [message],
          }))
        }
      }
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-3xl font-bold tracking-tight normal-case">
          Enter your passcode
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            form.handleSubmit()
          }}
        >
          <FieldGroup>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <>
                  <form.Field name="code">
                    {(field) => {
                      const invalid = field.state.meta.errors.length > 0
                      return (
                        <Field data-invalid={invalid || undefined}>
                          <InputOTP
                            id={field.name}
                            maxLength={6}
                            autoFocus
                            autoComplete="one-time-code"
                            disabled={isSubmitting}
                            aria-invalid={invalid || undefined}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(value) => field.handleChange(value)}
                            containerClassName="w-full"
                          >
                            <OtpSlots />
                          </InputOTP>
                          {invalid && (
                            <FieldError>
                              {String(field.state.meta.errors[0])}
                            </FieldError>
                          )}
                        </Field>
                      )
                    }}
                  </form.Field>
                  <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
                    {isSubmitting && <Spinner data-icon="inline-start" />}
                    {isSubmitting ? "Verifying" : "View my key"}
                  </Button>
                </>
              )}
            </form.Subscribe>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

export function InvalidLinkCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-3xl font-bold tracking-tight normal-case">
          Link not found
        </CardTitle>
        <CardDescription>
          This share link is no longer valid. Ask the person who gave it to
          you for a new one.
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
