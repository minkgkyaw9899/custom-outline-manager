import { ZapIcon } from "lucide-react"

import { ModeToggle } from "@/components/layout/mode-toggle"

export function AuthLayout({
  children,
  badge = "Admin console",
  heading = "Transfer your data at light speed.",
  description = "Invisigate manages your servers, access keys, renewals and revenue from one encrypted console.",
}: Readonly<{
  children: React.ReactNode
  badge?: string
  heading?: string
  description?: string
}>) {
  return (
    <div className="flex min-h-svh flex-col lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <aside className="relative flex flex-col justify-between gap-10 overflow-hidden bg-[linear-gradient(155deg,#030817_0%,#0a1a38_55%,#020611_100%)] p-6 lg:p-14">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary">
            <ZapIcon className="size-4.5 text-primary-foreground" strokeWidth={2.4} />
          </div>
          <div className="font-heading text-lg font-bold tracking-tight text-[#eaf1ff]">
            Invisigate VPN
          </div>
        </div>

        <div className="max-w-md">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-blue-300 lg:mb-7">
            <span className="size-1.5 rounded-full bg-blue-400" />
            {badge}
          </div>
          <h1 className="mb-4 font-heading text-3xl font-bold tracking-tight text-balance text-[#f2f6ff] lg:text-5xl">
            {heading}
          </h1>
          <p className="text-sm leading-relaxed text-[#dfe9ff]/60 lg:text-base">
            {description}
          </p>
        </div>

        <div className="hidden text-xs font-medium text-[#dfe9ff]/40 lg:block">
          Invisigate VPN · light-speed data transfer
        </div>
      </aside>

      <main className="relative flex flex-1 items-center justify-center p-6 py-14 lg:p-14">
        <div className="absolute top-4 right-4 lg:top-7 lg:right-8">
          <ModeToggle />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
