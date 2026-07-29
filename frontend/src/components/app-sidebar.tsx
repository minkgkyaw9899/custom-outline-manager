import { useState } from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  LayoutDashboardIcon,
  LogOutIcon,
  ServerIcon,
  SettingsIcon,
  ShoppingCartIcon,
  UsersIcon,
  WalletIcon,
  ZapIcon,
} from "lucide-react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useAuth, useLogout } from "@/lib/auth"

const NAV_ITEMS = [
  { title: "Overview", url: "/admin/overview", icon: LayoutDashboardIcon },
  // Both key holders and dashboard operators live here, on one page with a
  // table each — they are two kinds of "user" and were never worth two nav
  // entries.
  { title: "Users", url: "/admin/users", icon: UsersIcon },
  { title: "Servers", url: "/admin/servers", icon: ServerIcon },
  { title: "Revenue", url: "/admin/revenue", icon: WalletIcon },
  { title: "Orders", url: "/admin/orders", icon: ShoppingCartIcon },
  { title: "Settings", url: "/admin/settings", icon: SettingsIcon },
]

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { admin } = useAuth()
  const logout = useLogout()
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)

  const username = admin?.email.split("@")[0] ?? ""

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ZapIcon className="size-4" />
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate font-heading text-sm font-semibold">
              Invisigate VPN
            </span>
            <span className="truncate text-xs text-muted-foreground">
              Light-speed transfer
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive =
                  item.url === "/admin/overview"
                    ? pathname === "/admin/overview"
                    : pathname.startsWith(item.url)
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      render={<Link to={item.url} />}
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 rounded-lg border p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-0">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">
              {username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">{username}</span>
            <span className="truncate text-xs text-muted-foreground">
              {admin?.isRoot ? "Root admin" : "Admin"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Log out"
            className="group-data-[collapsible=icon]:hidden"
            onClick={() => setConfirmLogoutOpen(true)}
            disabled={logout.isPending}
          >
            <LogOutIcon />
          </Button>
        </div>
      </SidebarFooter>

      <ConfirmDialog
        open={confirmLogoutOpen}
        onOpenChange={setConfirmLogoutOpen}
        title="Log out?"
        description="You'll need to sign in again with an emailed code to get back in."
        confirmLabel="Log out"
        confirmVariant="default"
        onConfirm={() => logout.mutate()}
        isPending={logout.isPending}
      />
    </Sidebar>
  )
}
