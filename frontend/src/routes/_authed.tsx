import { createFileRoute, redirect } from "@tanstack/react-router"

import { AppLayout } from "@/components/app-layout"
import { queryClient } from "@/lib/query-client"
import { authMeQueryOptions } from "@/lib/auth"

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    try {
      await queryClient.ensureQueryData(authMeQueryOptions())
    } catch {
      throw redirect({ to: "/admin/login" })
    }
  },
  component: AppLayout,
})
