/**
 * Pure helpers for the /api/health probe. Kept import-free so the
 * `node --test --experimental-strip-types` runner can load them
 * (no `@/` alias resolution). The route in app/api/health/route.ts
 * adds the DB ping + filesystem migration scan on top.
 */

export type ProviderName =
  | "anthropic"
  | "openai"
  | "sentry"
  | "brave"
  | "serper"
  | "tavily"
  | "exa"
  | "google"
  | "supabase"
  | "supabase_admin"
  | "github"
  | "producthunt"
  | "inngest"
  | "temporal"
  | "temporal_voice_bridge"
  | "scraper"
  | "whatsapp"
  | "hubspot"
  | "razorpay"
  | "stripe";

export type ProviderMatrix = Record<ProviderName, boolean>;

/**
 * Translate a (presumed-redacted) env snapshot into a boolean matrix —
 * "is this provider configured?" — without leaking keys. We accept an
 * env-like object instead of reading process.env directly so the helper
 * is testable.
 */
export function getProviderMatrix(
  env: Record<string, string | undefined>,
): ProviderMatrix {
  const has = (k: string) => Boolean(env[k] && env[k]!.length > 0);
  return {
    anthropic: has("ANTHROPIC_API_KEY"),
    openai: has("OPENAI_API_KEY"),
    sentry: has("SENTRY_DSN"),
    brave: has("BRAVE_SEARCH_KEY") || has("BRAVE_API_KEY"),
    serper: has("SERPER_API_KEY"),
    tavily: has("TAVILY_API_KEY"),
    exa: has("EXA_API_KEY"),
    google: has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET"),
    supabase:
      has("NEXT_PUBLIC_SUPABASE_URL") && has("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabase_admin: has("SUPABASE_SERVICE_ROLE_KEY"),
    github: has("GITHUB_TOKEN"),
    producthunt: has("PRODUCTHUNT_TOKEN"),
    inngest: has("INNGEST_EVENT_KEY") && has("INNGEST_SIGNING_KEY"),
    temporal: has("TEMPORAL_ADDRESS") || has("TEMPORAL_CLIENT_ADDRESS"),
    temporal_voice_bridge:
      has("TEMPORAL_BRIDGE_SECRET") &&
      (env.TEMPORAL_BRIDGE_SECRET?.length ?? 0) >= 32 &&
      env.VOICE_LEGAL_LAUNCH_APPROVED === "true",
    scraper: has("SCRAPER_URL") && has("SCRAPER_KEY"),
    whatsapp:
      has("WHATSAPP_API_URL") &&
      has("WHATSAPP_API_KEY") &&
      has("WHATSAPP_FROM"),
    hubspot: has("HUBSPOT_API_KEY"),
    razorpay: has("RAZORPAY_KEY_ID") && has("RAZORPAY_KEY_SECRET"),
    stripe: has("STRIPE_SECRET_KEY"),
  };
}

/**
 * From a list of migration filenames like ["0001_init.sql",
 * "0011_whatsapp_outreach.sql"], return the highest-numbered one.
 * Caller passes a `readdirSync`-style listing.
 */
export function pickLatestMigration(filenames: string[]): string | null {
  if (!filenames || filenames.length === 0) return null;
  const sql = filenames.filter((f) => f.endsWith(".sql"));
  if (sql.length === 0) return null;
  // Sort by numeric prefix descending, fall back to lexicographic.
  const ranked = sql
    .map((f) => {
      const m = /^(\d+)/.exec(f);
      const n = m ? Number.parseInt(m[1], 10) : -1;
      return { f, n };
    })
    .sort((a, b) => b.n - a.n || (a.f < b.f ? 1 : -1));
  return ranked[0]?.f ?? null;
}

export interface HealthSummary {
  ok: boolean;
  service: "aravya_salesengai";
  version: string;
  timestamp: string;
  uptime_seconds: number;
  providers: ProviderMatrix;
  db: { ok: boolean; latency_ms: number | null; error?: string };
  schema_version: string | null;
  crons: Array<{ path: string; schedule: string }>;
}
