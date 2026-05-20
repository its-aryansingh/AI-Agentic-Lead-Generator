import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * /app/settings/providers
 *
 * Lists every external integration we use, with a "connected" /
 * "demo data" badge derived from env-var presence. Reads env vars
 * server-side only — never exposes the values themselves.
 *
 * Useful when a user is wondering why their results have "demo data"
 * tags on them and which API key fixes that.
 */

interface Provider {
  name: string
  description: string
  envVars: string[]
  docsUrl: string
  whenMissing: string
}

const PROVIDERS: Provider[] = [
  {
    name: "Anthropic Claude",
    description: "Powers chat orchestration + cold email drafting (Sonnet) and cheap research summaries (Haiku).",
    envVars: ["ANTHROPIC_API_KEY"],
    docsUrl: "https://console.anthropic.com",
    whenMissing: "Chat replies are canned mock responses instead of real LLM completions.",
  },
  {
    name: "Brave Search",
    description: "Prospect discovery from public web search (2000 free queries/month).",
    envVars: ["BRAVE_SEARCH_KEY"],
    docsUrl: "https://search.brave.com/search/api",
    whenMissing: "web_search returns 15 deterministic mock candidates instead of real results.",
  },
  {
    name: "Google Sheets",
    description: "Exports bulk-enrichment jobs to a new sheet in the user's Drive (drive.file scope).",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    docsUrl: "https://console.cloud.google.com",
    whenMissing: "Bulk jobs return a mock Sheet URL; the CSV download still works.",
  },
  {
    name: "Supabase",
    description: "Persistent storage for chat history, jobs, prospects, and credit ledger. Also handles Google OAuth.",
    envVars: [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
    docsUrl: "https://supabase.com",
    whenMissing: "App can't sign you in — required for any user-facing run.",
  },
  {
    name: "GitHub",
    description: "Public-source search for technical founders, CTOs, indie hackers via /api/search/users.",
    envVars: ["GITHUB_TOKEN"],
    docsUrl: "https://github.com/settings/tokens",
    whenMissing: "Search works unauthenticated at 60 req/hour; with a token you get 5000/hour.",
  },
]

export default function ProvidersPage() {
  const rows = PROVIDERS.map((p) => ({
    ...p,
    connected: p.envVars.every((v) => Boolean(process.env[v])),
  }))

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-6 py-4 border-b border-border">
        <h1 className="text-base font-semibold">Connected providers</h1>
      </header>

      <section className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          {rows.map((p) => (
            <Card key={p.name} size="sm">
              <CardHeader className="px-4">
                <CardTitle className="flex items-center gap-2">
                  {p.name}
                  {p.connected ? (
                    <Badge variant="default">connected</Badge>
                  ) : (
                    <Badge variant="secondary">demo data</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="text-muted-foreground">{p.description}</div>
                {!p.connected && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">When missing:</span>{" "}
                    {p.whenMissing}
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground flex flex-wrap gap-2 mt-1">
                  <span>Env vars:</span>
                  {p.envVars.map((v) => (
                    <code
                      key={v}
                      className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded"
                    >
                      {v}
                    </code>
                  ))}
                  <a
                    href={p.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 ml-auto"
                  >
                    docs →
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}

          <p className="text-xs text-muted-foreground mt-4">
            Drop missing values into <code className="font-mono">.env.local</code>{" "}
            and restart the dev server. Existing chats and jobs continue using
            whatever provider was active when they ran.
          </p>
        </div>
      </section>
    </div>
  )
}
