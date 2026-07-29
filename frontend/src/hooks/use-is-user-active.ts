import { useEffect, useRef, useState } from "react"

/** No interaction for this long counts as idle. */
const DEFAULT_IDLE_AFTER_MS = 5 * 60_000

/**
 * Whether the admin is actually present: the tab is visible *and* they have
 * interacted within `idleAfterMs`.
 *
 * TanStack Query's own `refetchIntervalInBackground: false` already pauses
 * polling for a hidden tab, but a tab left open on a second monitor stays
 * "visible" forever and would poll all night. Gating on real interaction stops
 * that, so an unattended dashboard costs the Outline servers nothing.
 */
export function useIsUserActive(
  idleAfterMs: number = DEFAULT_IDLE_AFTER_MS
): boolean {
  const [active, setActive] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const goIdle = () => setActive(false)

    const markActive = () => {
      setActive(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(goIdle, idleAfterMs)
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimeout(timerRef.current)
        goIdle()
      } else {
        markActive()
      }
    }

    // `pointermove` covers mouse and touch; passive so scrolling stays smooth.
    const events = ["pointerdown", "pointermove", "keydown", "scroll"] as const
    for (const event of events) {
      window.addEventListener(event, markActive, { passive: true })
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    markActive()

    return () => {
      clearTimeout(timerRef.current)
      for (const event of events) {
        window.removeEventListener(event, markActive)
      }
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [idleAfterMs])

  return active
}
