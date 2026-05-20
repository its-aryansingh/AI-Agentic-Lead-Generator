import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const features = [
  {
    title: 'Conversational search',
    desc: 'Type "find me 20 CTOs at fintech startups in India" and get real results from the web and GitHub.',
  },
  {
    title: 'AI-drafted emails',
    desc: 'Each prospect gets a personalized cold email — not a template with [FIRST NAME].',
  },
  {
    title: 'Exports to Google Sheets',
    desc: 'One click to push enriched prospects + email drafts to your Drive.',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-foreground tracking-tight">LeadGenAI</span>
        <Link href="/login">
          <Button variant="outline" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-8 py-24">
        <Badge variant="secondary">Free · 25 prospects / month</Badge>

        <h1 className="text-4xl font-semibold tracking-tight max-w-xl leading-tight">
          Find leads and draft cold emails — without the manual research
        </h1>

        <p className="text-muted-foreground max-w-md text-lg">
          Describe your ideal customer in plain English. LeadGenAI searches the web,
          finds matching prospects, and drafts a personalized first-touch email for each one.
        </p>

        <Link href="/login">
          <Button size="lg" className="px-8">
            Get started for free
          </Button>
        </Link>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 text-left max-w-2xl w-full">
          {features.map((f) => (
            <div key={f.title} className="border border-border rounded-xl p-4">
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
