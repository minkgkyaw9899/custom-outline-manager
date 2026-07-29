import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"

import { SyncAllButton } from "@/components/sync-all-button"
import { AdminsTable } from "@/components/users/admins-table"
import { UsersTable } from "@/components/users/users-table"
import { usersQueryOptions } from "@/lib/queries"

export const Route = createFileRoute("/_authed/admin/users/")({
  component: UsersPage,
})

/**
 * Both kinds of "user" on one page: the holders keys are handed to, and the
 * operators who run this dashboard. They are unrelated records with unrelated
 * lifecycles, so they get a table each rather than a merged one.
 */
function UsersPage() {
  const { data: users, isLoading } = useQuery(usersQueryOptions())

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Dashboard / Users</p>
          <h1 className="font-heading text-2xl font-semibold">Users</h1>
        </div>
        <SyncAllButton />
      </div>

      <UsersTable users={users ?? []} isLoading={isLoading} />
      <AdminsTable />
    </div>
  )
}
