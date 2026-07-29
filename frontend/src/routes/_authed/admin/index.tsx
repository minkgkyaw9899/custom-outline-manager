import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/overview" })
  },
})
