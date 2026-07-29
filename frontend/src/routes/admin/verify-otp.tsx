import { useEffect, useState } from "react"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { ArrowLeftIcon } from "lucide-react"

import { isApiError } from "@/lib/api"
import { applyServerFieldErrors } from "@/lib/form-errors"
import { useRequestOtp, useVerifyOtp } from "@/lib/auth"
import { AuthLayout } from "@/components/layout/auth-layout"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"

interface VerifyOtpSearch {
  email: string
  expiresIn: number
}

export const Route = createFileRoute("/admin/verify-otp")({
  validateSearch: (search: Record<string, unknown>): VerifyOtpSearch => ({
    email: typeof search.email === "string" ? search.email : "",
    expiresIn: Number(search.expiresIn) || 0,
  }),
  beforeLoad: ({ search }) => {
    if (!search.email) throw redirect({ to: "/admin/login" })
  },
  component: VerifyOtpPage,
})

function VerifyOtpPage() {
  const { email, expiresIn } = Route.useSearch()
  const navigate = useNavigate()
  const [secondsLeft, setSecondsLeft] = useState(expiresIn)

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const requestOtp = useRequestOtp()
  const verifyOtp = useVerifyOtp()

  const resend = () =>
    toast
      .promise(requestOtp.mutateAsync(email), {
        loading: "Sending a new code…",
        success: (data) => {
          setSecondsLeft(data.expiresInSeconds)
          return `New code sent to ${data.email}`
        },
        error: (err: unknown) =>
          isApiError(err) && err.apiError
            ? (err.apiError.details?.[0]?.message ?? err.apiError.message)
            : "Couldn't resend the code. Please try again.",
      })
      .catch(() => {})

  const form = useForm({
    defaultValues: { code: "" },
    onSubmit: async ({ value }) => {
      try {
        await verifyOtp.mutateAsync({ email, code: value.code })
        navigate({ to: "/admin/overview" })
      } catch (error) {
        if (isApiError(error) && error.apiError?.details?.length) {
          applyServerFieldErrors(form, error.apiError.details)
        }
      }
    },
  })

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = secondsLeft % 60

  return (
    <AuthLayout>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-3 mb-5"
        onClick={() => navigate({ to: "/admin/login" })}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Change email
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-3xl font-bold tracking-tight normal-case">
            Enter your code
          </CardTitle>
          <CardDescription>
            We sent a 6-digit code to{" "}
            <strong className="font-medium text-foreground">{email}</strong>.
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
                  <form.Field name="code">
                    {(field) => {
                      const invalid = field.state.meta.errors.length > 0
                      return (
                        <Field
                          data-invalid={invalid || undefined}
                          data-disabled={isSubmitting || undefined}
                        >
                          <InputOTP
                            id={field.name}
                            name={field.name}
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
                            <InputOTPGroup className="w-full justify-between gap-2">
                              {Array.from({ length: 6 }, (_, index) => (
                                <InputOTPSlot
                                  key={index}
                                  index={index}
                                  className="h-12 flex-1 text-lg"
                                />
                              ))}
                            </InputOTPGroup>
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
                )}
              </form.Subscribe>
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Button
                    type="submit"
                    size="lg"
                    disabled={isSubmitting}
                    className="w-full"
                  >
                    {isSubmitting && <Spinner data-icon="inline-start" />}
                    {isSubmitting ? "Verifying" : "Verify"}
                  </Button>
                )}
              </form.Subscribe>
            </FieldGroup>
          </form>

          <div className="mt-5 flex items-center justify-between border bg-muted/40 py-2 pr-2 pl-4">
            <div className="text-sm text-muted-foreground">Didn't get it?</div>
            <div className="flex items-center gap-2">
              {secondsLeft > 0 && (
                <span className="font-mono text-sm text-muted-foreground tabular-nums">
                  {minutes}:{seconds.toString().padStart(2, "0")}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={secondsLeft > 0 || requestOtp.isPending}
                onClick={resend}
              >
                {requestOtp.isPending && <Spinner data-icon="inline-start" />}
                {requestOtp.isPending ? "Sending" : "Resend code"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
