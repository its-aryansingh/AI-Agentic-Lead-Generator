import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Returns `true` when the viewport is below the mobile breakpoint.
 *
 * Implemented with useSyncExternalStore — the canonical React pattern
 * for reading from a browser API. Avoids the setState-in-effect
 * cascading-render anti-pattern that `react-hooks/set-state-in-effect`
 * (Next.js's lint config) flags.
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribeMatchMedia, getIsMobile, getServerSnapshot)
}

function subscribeMatchMedia(onChange: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function getIsMobile(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot(): boolean {
  // No viewport on the server — pretend we're desktop until hydration.
  return false
}
