"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  MessageSquarePlus,
  Search,
  FileSpreadsheet,
  Sparkles,
  Mail,
  Shield,
  ArrowRight,
  Zap,
  Globe,
  Check,
} from "lucide-react"

const queries = [
  "find me 20 heads of marketing at fintech startups in India",
  "research Priya Sharma at Razorpay",
  "get me 30 SaaS founders in Bangalore, 50-200 employees",
  "find CTOs at Series A startups in Southeast Asia",
  "research the VP of Sales at Freshworks",
]

const steps = [
  {
    icon: MessageSquarePlus,
    title: "Describe your ICP",
    desc: "Tell the AI who you're looking for in plain English. No filters, no forms — just a conversation.",
    accent: "oklch(0.65 0.18 180)",
  },
  {
    icon: Search,
    title: "AI researches & drafts",
    desc: "LeadGenAI searches public sources, enriches each prospect, and writes a personalized cold email in your voice.",
    accent: "oklch(0.55 0.25 290)",
  },
  {
    icon: FileSpreadsheet,
    title: "Export to Sheets or CSV",
    desc: "Results land directly in Google Sheets — the way SMB sales teams actually work. Or download a CSV.",
    accent: "oklch(0.75 0.15 75)",
  },
]

const features = [
  {
    icon: Sparkles,
    title: "Conversational search",
    desc: "Type naturally. The AI understands industry jargon, job titles, company sizes, and geography without rigid filters.",
    gradient: "from-[oklch(0.55_0.25_290)] to-[oklch(0.45_0.22_270)]",
  },
  {
    icon: Mail,
    title: "Emails that sound human",
    desc: "Multi-step prompts, banned-phrase filters, and a voice anchor mean drafts feel personal — never templated.",
    gradient: "from-[oklch(0.65_0.18_180)] to-[oklch(0.55_0.15_200)]",
  },
  {
    icon: Shield,
    title: "Compliance built-in",
    desc: "CAN-SPAM and GDPR rules are enforced automatically. One-click unsubscribe in every email. Suppression lists built in.",
    gradient: "from-[oklch(0.75_0.15_75)] to-[oklch(0.65_0.18_50)]",
  },
  {
    icon: Globe,
    title: "India & SEA focus",
    desc: "Built specifically for B2B sales teams in India and Southeast Asia. Understands local companies, naming patterns, and market context.",
    gradient: "from-[oklch(0.6_0.2_15)] to-[oklch(0.5_0.22_350)]",
  },
  {
    icon: Zap,
    title: "Gmail-native sending",
    desc: "Connect your Gmail, set warm-up caps, and send campaigns directly — with warm-up limits and reply detection built in.",
    gradient: "from-[oklch(0.7_0.12_230)] to-[oklch(0.6_0.15_250)]",
  },
  {
    icon: FileSpreadsheet,
    title: "Sheets-native workflow",
    desc: "Skip another dashboard. Output lands in Google Sheets with one click — the tool your team already lives in.",
    gradient: "from-[oklch(0.7_0.17_155)] to-[oklch(0.6_0.15_170)]",
  },
]

const stats = [
  { value: "25", label: "Free prospects / month" },
  { value: "0", label: "Credit card required" },
  { value: "30s", label: "Setup time" },
  { value: "7", label: "AI tools built in" },
]

function TypingAnimation() {
  const [queryIndex, setQueryIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    const current = queries[queryIndex]

    if (!isDeleting && charIndex < current.length) {
      const timeout = setTimeout(() => setCharIndex((c) => c + 1), 35)
      return () => clearTimeout(timeout)
    }

    if (!isDeleting && charIndex === current.length) {
      const timeout = setTimeout(() => setIsDeleting(true), 2200)
      return () => clearTimeout(timeout)
    }

    if (isDeleting && charIndex > 0) {
      const timeout = setTimeout(() => setCharIndex((c) => c - 1), 18)
      return () => clearTimeout(timeout)
    }

    if (isDeleting && charIndex === 0) {
      const timeout = setTimeout(() => {
        setIsDeleting(false)
        setQueryIndex((i) => (i + 1) % queries.length)
      }, 0)
      return () => clearTimeout(timeout)
    }
  }, [charIndex, isDeleting, queryIndex])

  return (
    <span className="font-mono text-[oklch(0.85_0.15_180)]">
      &quot;{queries[queryIndex].slice(0, charIndex)}&quot;
      <span className="inline-block w-[2px] h-[1em] ml-0.5 align-middle border-r-2 animate-[typing-cursor_1s_step-end_infinite]" />
    </span>
  )
}

function FloatingOrb({
  className,
  size,
  color,
  delay,
}: {
  className?: string
  size: number
  color: string
  delay: number
}) {
  return (
    <div
      className={`absolute rounded-full blur-3xl opacity-20 pointer-events-none ${className}`}
      style={{
        width: size,
        height: size,
        background: color,
        animationDelay: `${delay}s`,
      }}
    />
  )
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[oklch(0.08_0.02_280)] text-[oklch(0.92_0_0)] flex flex-col overflow-x-hidden">
      {/* ─── Floating background orbs ─── */}
      <FloatingOrb
        className="animate-float top-[10%] left-[5%]"
        size={400}
        color="oklch(0.3 0.15 290)"
        delay={0}
      />
      <FloatingOrb
        className="animate-float-delayed top-[30%] right-[10%]"
        size={350}
        color="oklch(0.25 0.12 180)"
        delay={2}
      />
      <FloatingOrb
        className="animate-float bottom-[20%] left-[40%]"
        size={300}
        color="oklch(0.2 0.1 230)"
        delay={4}
      />

      {/* ─── Header ─── */}
      <header className="relative z-10 px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[oklch(0.55_0.25_290)] to-[oklch(0.65_0.18_180)] flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-[oklch(0.95_0_0)]">
            LeadGenAI
          </span>
        </div>
        <Link
          href="/login"
          className="px-5 py-2 text-sm font-medium rounded-full border border-[oklch(1_0_0_/_15%)] bg-[oklch(1_0_0_/_5%)] hover:bg-[oklch(1_0_0_/_10%)] transition-all duration-300 hover:border-[oklch(1_0_0_/_25%)]"
        >
          Sign in
        </Link>
      </header>

      {/* ─── Hero Section ─── */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-16 pb-20 md:pt-24 md:pb-28 max-w-5xl mx-auto">
        <div
          className="animate-text-reveal inline-flex items-center gap-2 mb-8 px-4 py-1.5 rounded-full text-xs font-medium border border-[oklch(0.65_0.18_180_/_30%)] bg-[oklch(0.65_0.18_180_/_8%)] text-[oklch(0.8_0.12_180)]"
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[oklch(0.7_0.15_180)] animate-pulse-dot" />
          Free tier · 25 prospects / month · No credit card
        </div>

        <h1
          className="animate-text-reveal text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] max-w-4xl"
          style={{ animationDelay: "0.15s" }}
        >
          AI prospecting that{" "}
          <span className="bg-gradient-to-r from-[oklch(0.65_0.18_180)] via-[oklch(0.6_0.22_260)] to-[oklch(0.55_0.25_290)] bg-clip-text text-transparent">
            actually sounds
          </span>{" "}
          like you wrote it
        </h1>

        <p
          className="animate-text-reveal mt-6 text-lg md:text-xl text-[oklch(0.7_0_0)] max-w-2xl leading-relaxed"
          style={{ animationDelay: "0.3s" }}
        >
          Describe your ideal customer in plain English. LeadGenAI finds matching
          prospects, drafts a personalized first-touch email for each, and drops
          the lot into a Google Sheet.
        </p>

        {/* Typing demo */}
        <div
          className="animate-text-reveal mt-8 w-full max-w-xl px-5 py-4 rounded-2xl bg-[oklch(1_0_0_/_4%)] border border-[oklch(1_0_0_/_8%)] backdrop-blur-sm text-left text-sm md:text-base"
          style={{ animationDelay: "0.45s" }}
        >
          <span className="text-[oklch(0.5_0_0)]">→ </span>
          <TypingAnimation />
        </div>

        {/* CTA */}
        <div
          className="animate-text-reveal mt-10 flex flex-col sm:flex-row items-center gap-4"
          style={{ animationDelay: "0.6s" }}
        >
          <Link
            href="/login"
            className="btn-brand px-8 py-3.5 rounded-full text-base font-semibold flex items-center gap-2 animate-glow-pulse"
          >
            Get started for free
            <ArrowRight className="w-4 h-4" />
          </Link>
          <span className="text-sm text-[oklch(0.5_0_0)]">
            No credit card required
          </span>
        </div>
      </section>

      {/* ─── Stats Bar ─── */}
      <section className="relative z-10 border-y border-[oklch(1_0_0_/_6%)] py-10">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-[oklch(0.65_0.18_180)] to-[oklch(0.55_0.25_290)] bg-clip-text text-transparent">
                {s.value}
              </div>
              <div className="mt-1 text-sm text-[oklch(0.55_0_0)]">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className="relative z-10 py-20 md:py-28 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center tracking-tight mb-4">
            Three steps to your first outreach
          </h2>
          <p className="text-center text-[oklch(0.6_0_0)] max-w-xl mx-auto mb-16">
            From idea to inbox in under a minute. No forms, no filters, no setup.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {steps.map((step, i) => (
              <div
                key={step.title}
                className="animate-scale-in relative glass-card-landing rounded-2xl p-6 md:p-8"
                style={{ animationDelay: `${i * 0.15}s` }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: `${step.accent}20` }}
                  >
                    <step.icon
                      className="w-5 h-5"
                      style={{ color: step.accent }}
                    />
                  </div>
                  <span className="text-xs font-mono text-[oklch(0.5_0_0)] uppercase tracking-wider">
                    Step {i + 1}
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                <p className="text-sm text-[oklch(0.6_0_0)] leading-relaxed">
                  {step.desc}
                </p>

                {/* Connector arrow — shown between cards on desktop */}
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute -right-4 top-1/2 -translate-y-1/2 z-10 text-[oklch(0.4_0_0)]">
                    <ArrowRight className="w-5 h-5" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features Grid ─── */}
      <section className="relative z-10 py-20 md:py-28 px-6 border-t border-[oklch(1_0_0_/_6%)]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center tracking-tight mb-4">
            Everything you need to prospect smarter
          </h2>
          <p className="text-center text-[oklch(0.6_0_0)] max-w-xl mx-auto mb-16">
            Built for scrappy B2B teams who need results, not another dashboard to learn.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="animate-scale-in glass-card-landing rounded-2xl p-6 group"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <f.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-[oklch(0.6_0_0)] leading-relaxed">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Use Cases Banner ─── */}
      <section className="relative z-10 py-20 px-6 border-t border-[oklch(1_0_0_/_6%)]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center tracking-tight mb-10">
            Just type what you need
          </h2>
          <div className="space-y-3">
            {queries.slice(0, 4).map((q, i) => (
              <div
                key={q}
                className="animate-slide-in-up flex items-center gap-3 px-5 py-3.5 rounded-xl bg-[oklch(1_0_0_/_3%)] border border-[oklch(1_0_0_/_6%)] hover:border-[oklch(1_0_0_/_15%)] hover:bg-[oklch(1_0_0_/_5%)] transition-all duration-300 group"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <span className="text-[oklch(0.65_0.18_180)] font-mono text-sm">→</span>
                <span className="font-mono text-sm text-[oklch(0.75_0_0)] group-hover:text-[oklch(0.85_0.1_180)] transition-colors">
                  &quot;{q}&quot;
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="relative z-10 py-24 md:py-32 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            Ready to find your next customers?
          </h2>
          <p className="text-[oklch(0.6_0_0)] mb-8 text-lg">
            Start for free. 25 prospects per month. No credit card.
          </p>
          <Link
            href="/login"
            className="btn-brand inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-base font-semibold animate-glow-pulse"
          >
            Get started now
            <ArrowRight className="w-4 h-4" />
          </Link>

          <div className="mt-10 flex flex-wrap justify-center gap-6 text-sm text-[oklch(0.55_0_0)]">
            <span className="flex items-center gap-1.5">
              <Check className="w-4 h-4 text-[oklch(0.65_0.18_180)]" /> Free tier available
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="w-4 h-4 text-[oklch(0.65_0.18_180)]" /> Google Sheets export
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="w-4 h-4 text-[oklch(0.65_0.18_180)]" /> CAN-SPAM compliant
            </span>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="relative z-10 border-t border-[oklch(1_0_0_/_6%)] px-6 py-6 text-center">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-[oklch(0.55_0.25_290)] to-[oklch(0.65_0.18_180)] flex items-center justify-center">
              <Zap className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm font-medium text-[oklch(0.7_0_0)]">LeadGenAI</span>
          </div>
          <span className="text-xs text-[oklch(0.4_0_0)]">
            Built for SMB sales teams in India and Southeast Asia
          </span>
        </div>
      </footer>
    </div>
  )
}
