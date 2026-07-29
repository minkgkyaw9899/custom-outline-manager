import {
  InfoIcon,
  RefreshCwIcon,
  SparklesIcon,
  UserRoundCheckIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/**
 * Same two benefits, worded for who's actually reading: the admin dialog
 * talks about "this holder" from the outside; the holder's own status page
 * (an unauthenticated, public URL — see routes/users.keys-status.$slug)
 * needs first person instead, or "this holder" reads as if it's talking
 * about someone else on the holder's own page.
 */
const BENEFITS = {
  admin: [
    {
      icon: RefreshCwIcon,
      title: "The link never changes",
      body: "Renewing, topping up, or moving this holder to a new key or server doesn't change what they connect with — the same link keeps resolving, so nobody has to be sent a new one.",
    },
    {
      icon: UserRoundCheckIcon,
      title: "Follows the person, not the key",
      body: "Reassign this holder to a different key entirely (a fresh device, a server migration) and their existing link picks up the new connection automatically.",
    },
  ],
  holder: [
    {
      icon: RefreshCwIcon,
      title: "It never changes",
      body: "Renewals, top-ups, or being moved to a different key or server don't change what you connect with — this same link keeps working, so you never have to update it or ask for a new one.",
    },
    {
      icon: UserRoundCheckIcon,
      title: "Follows you, not the key",
      body: "If you're ever moved to a different key entirely (a fresh device, a server change), this same link automatically picks up the new connection.",
    },
  ],
} as const

/**
 * "Recommended" badge for the dynamic link, with an info trigger that
 * explains why — both benefits are real, verified behavior (see
 * DynamicAccessURL / users.primary_key_id in the backend), not generic
 * marketing copy. Deliberately doesn't claim any security advantage: the
 * dynamic endpoint is public/unauthenticated by design and resolves to the
 * exact same connection info a static link encodes, so the honest case for
 * it is entirely about not having to redistribute links.
 */
export function DynamicLinkRecommendedBadge({
  audience = "admin",
}: Readonly<{ audience?: "admin" | "holder" }>) {
  const benefits = BENEFITS[audience]
  return (
    <Dialog>
      <span className="inline-flex items-center gap-1">
        <Badge
          variant="outline"
          className="gap-1 border-primary/30 bg-primary/10 text-primary"
        >
          <SparklesIcon />
          Recommended
        </Badge>
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-5 text-muted-foreground hover:text-foreground"
              aria-label="Why the dynamic link is recommended"
            />
          }
        >
          <InfoIcon className="size-3.5" />
        </DialogTrigger>
      </span>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why the dynamic link is recommended</DialogTitle>
          <DialogDescription>
            {audience === "holder"
              ? "Use this one instead of the static key below."
              : "Hand this one out over the static key below."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {benefits.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-sm text-muted-foreground">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
