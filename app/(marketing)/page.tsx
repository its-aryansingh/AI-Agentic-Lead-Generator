import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const features = [
  {
    title: "Conversational search",
    desc: "Type 'find me 20 CTOs at fintech startups in India' and get real candidates from the public web in seconds.",
  },
  {
    title: "Emails that don't read like AI",
    desc: "Multi-step prompts, banned-phrase filters, and a voice anchor mean drafts feel personal — not templated.",
  },
  {
    title: "Sheets-native workflow",
    desc: "Skip another dashboard. Output lands in Google Sheets or downloads as CSV — the way SMB sales teams actually work.",
  },
]

const useCases = [
  '"find me 20 heads of marketing at fintech startups in India"',
  '"research Priya Sharma at Razorpay"',
  '"get me 30 SaaS founders in Bangalore, 50-200 employees"',
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-foreground tracking-tight">
          LeadGenAI
        </span>
        <Link href="/login">
          <Button variant="outline" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-8 py-20 max-w-4xl mx-auto">
        <Badge variant="secondary">
          Free tier · 25 prospects / month · India + SEA focus
        </Badge>

        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight max-w-2xl">
          AI prospecting that actually sounds like you wrote it
        </h1>

        <p className="text-muted-foreground max-w-xl text-lg">
          Describe your ideal customer in plain English. LeadGenAI finds
          matching prospects, drafts a personalized first-touch email for each
          one, and drops the lot into a Google Sheet.
        </p>

        <Link href="/login">
          <Button size="lg" className="px-8">
            Get started for free
          </Button>
        </Link>

        <div className="text-xs text-muted-foreground flex flex-col gap-1 mt-2">
          <div>Try one of these:</div>
          {useCases.map((u) => (
            <div key={u} className="font-mono">
              {u}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 text-left w-full">
          {features.map((f) => (
            <div
              key={f.title}
              className="border border-border rounded-xl p-4 bg-card"
            >
              <div className="font-medium text-sm mb-1">{f.title}</div>
              <div className="text-muted-foreground text-sm">{f.desc}</div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        Built for SMB sales teams in India and Southeast Asia
      </footer>
    </div>
  )
}
