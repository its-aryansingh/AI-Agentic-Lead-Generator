import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Standard shadcn className merger. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Returns true if a recognized API key for the given provider is configured.
 * Used by provider modules to swap in mock data when keys are missing.
 * The app is designed to run usefully out-of-the-box without external accounts.
 */
export function hasKey(
  name: "anthropic" | "openai" | "brave" | "serper" | "tavily" | "exa" | "google",
): boolean {
  switch (name) {
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY)
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY)
    // BRAVE_API_KEY is the name the search aggregator ported from
    // SalesEngAIMVP expects; BRAVE_SEARCH_KEY is what this repo's
    // .env.example has always used. Accept both rather than silently
    // falling back to mock results because of a naming mismatch.
    case "brave":
      return Boolean(process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY)
    case "serper":
      return Boolean(process.env.SERPER_API_KEY)
    case "tavily":
      return Boolean(process.env.TAVILY_API_KEY)
    case "exa":
      return Boolean(process.env.EXA_API_KEY)
    case "google":
      return Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      )
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Deterministic hash of a string into an int in [0, n).
 * Used by mock providers to produce stable-but-varied output for the same query.
 */
export function hashIndex(seed: string, n: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h) % Math.max(1, n)
}
