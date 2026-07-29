import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useForm } from "@tanstack/react-form"
import { MailIcon } from "lucide-react"

import { isApiError } from "@/lib/api"
import { applyServerFieldErrors } from "@/lib/form-errors"
import { useRequestOtp } from "@/lib/auth"
import { AuthLayout } from "@/components/auth-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"

export const Route = createFileRoute("/admin/login")({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const requestOtp = useRequestOtp()

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      try {
        const data = await toast.promise(requestOtp.mutateAsync(value.email), {
          loading: "Sending a login code…",
          success: (d) => `Login code sent to ${d.email}`,
          error: (err: unknown) =>
            isApiError(err) && err.apiError
              ? (err.apiError.details?.[0]?.message ?? err.apiError.message)
              : "Couldn't send the login code. Please try again.",
        })
        navigate({
          to: "/admin/verify-otp",
          search: { email: data.email, expiresIn: data.expiresInSeconds },
        })
      } catch (error) {
        if (isApiError(error) && error.apiError?.details?.length) {
          applyServerFieldErrors(form, error.apiError.details)
        }
      }
    },
  })

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <div className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
            Admin access
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight normal-case">
            Sign in to Invisigate
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
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <FieldGroup>
                  <form.Field name="email">
                    {(field) => {
                      const invalid = field.state.meta.errors.length > 0
                      return (
                        <Field
                          data-invalid={invalid || undefined}
                          data-disabled={isSubmitting || undefined}
                        >
                          <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                          <InputGroup>
                            <InputGroupAddon>
                              <MailIcon />
                            </InputGroupAddon>
                            <InputGroupInput
                              id={field.name}
                              name={field.name}
                              type="email"
                              autoComplete="email"
                              autoFocus
                              placeholder="Enter your email"
                              disabled={isSubmitting}
                              aria-invalid={invalid || undefined}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                            />
                          </InputGroup>
                          {invalid && (
                            <FieldError>
                              {String(field.state.meta.errors[0])}
                            </FieldError>
                          )}
                        </Field>
                      )
                    }}
                  </form.Field>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={isSubmitting}
                    className="w-full"
                  >
                    {isSubmitting && <Spinner data-icon="inline-start" />}
                    {isSubmitting ? "Logging in" : "Login"}
                  </Button>
                </FieldGroup>
              )}
            </form.Subscribe>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
