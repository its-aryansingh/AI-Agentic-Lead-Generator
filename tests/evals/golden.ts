/**
 * Golden prospect set for the draft-quality eval harness.
 *
 * 8 prospects spanning the Indian SaaS / SEA fintech / agency wedges
 * we care about. The eval runs each one through draftForProspect
 * (in mock mode by default — no Anthropic key needed for CI) and
 * scores the output against a heuristic ruleset.
 */

import type { ProspectCandidate } from "../../lib/csv-parse.ts"

export interface GoldenProspect {
  id: string
  prospect: ProspectCandidate
  voiceAnchor?: string
}

// Re-declare ProspectCandidate shape locally so this file has zero
// imports from anywhere except types — keeps the eval insulated from
// chain-import explosions.
type LocalCandidate = {
  name: string
  title: string
  company: string
  location?: string
  source: "brave" | "duckduckgo" | "mock" | "github" | "hn" | "producthunt" | "named" | "csv"
  source_url: string
  snippet: string
}

export const GOLDEN_SET: Array<{
  id: string
  prospect: LocalCandidate
  voiceAnchor?: string
}> = [
  {
    id: "razorpay-priya",
    prospect: {
      name: "Priya Sharma",
      title: "Head of Marketing",
      company: "Razorpay",
      location: "Bangalore",
      source: "brave",
      source_url: "https://www.linkedin.com/in/priya-sharma",
      snippet: "Priya Sharma leads marketing at Razorpay, focused on mid-market.",
    },
  },
  {
    id: "freshworks-rahul",
    prospect: {
      name: "Rahul Mehta",
      title: "VP Sales",
      company: "Freshworks",
      location: "Chennai",
      source: "brave",
      source_url: "https://www.linkedin.com/in/rahul-mehta",
      snippet: "Rahul Mehta - VP Sales at Freshworks, scaling outbound across APAC.",
    },
  },
  {
    id: "postman-tanvir",
    prospect: {
      name: "Tanvir Ahmed",
      title: "Head of Demand Gen",
      company: "Postman",
      location: "Singapore",
      source: "brave",
      source_url: "https://www.linkedin.com/in/tanvir-ahmed",
      snippet: "Demand gen lead at Postman, runs ABM across SEA.",
    },
  },
  {
    id: "pesto-faisal",
    prospect: {
      name: "Faisal Khan",
      title: "Co-founder & CEO",
      company: "Pesto Tech",
      location: "Bangalore",
      source: "brave",
      source_url: "https://www.linkedin.com/in/faisal-khan",
      snippet: "Co-founder of Pesto Tech, hiring engineers from non-tier-1 colleges.",
    },
  },
  {
    id: "khatabook-mira",
    prospect: {
      name: "Mira Kapoor",
      title: "Growth Lead",
      company: "Khatabook",
      location: "Mumbai",
      source: "brave",
      source_url: "https://www.linkedin.com/in/mira-kapoor",
      snippet: "Growth at Khatabook — Tier 2/3 city merchant acquisition.",
    },
  },
  {
    id: "chargebee-arjun",
    prospect: {
      name: "Arjun Reddy",
      title: "CRO",
      company: "Chargebee",
      location: "Chennai",
      source: "brave",
      source_url: "https://www.linkedin.com/in/arjun-reddy",
      snippet: "Chief Revenue Officer at Chargebee, scaling US + EU expansion.",
    },
  },
  {
    id: "github-indie-hacker",
    prospect: {
      name: "Lakshmi Rao",
      title: "Indie hacker building dev tools",
      company: "(independent)",
      source: "github",
      source_url: "https://github.com/lakshmi-rao",
      snippet: "GitHub profile @lakshmi-rao · Bangalore · Building open-source dev tools.",
    },
  },
  {
    id: "hn-poster",
    prospect: {
      name: "vikramsingh",
      title: "Active on Hacker News",
      company: "(independent)",
      source: "hn",
      source_url: "https://news.ycombinator.com/user?id=vikramsingh",
      snippet:
        "Show HN: We built a Sheets-native CRM for SMBs in India — feedback welcome",
    },
  },
]
