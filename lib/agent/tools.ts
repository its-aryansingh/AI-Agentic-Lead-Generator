/**
 * Chat agent tools — Vercel AI SDK tool definitions.
 *
 * Each tool is a thin wrapper that calls into a tool-handler. The handlers
 * live in tool-handlers.ts so they can be exercised independently in tests.
 *
 * The handler functions take { userId, sessionId } as context the chat
 * route passes in — never trust the model to provide these.
 */

import { tool } from "ai"
import { z } from "zod"

import {
  handleAddNamedProspects,
  handleClarify,
  handleEnrichProspect,
  handleLaunchCampaign,
  handlePublicSourceSearch,
  handleStartBulkJob,
  handleWebSearch,
} from "./tool-handlers"

export interface ToolContext {
  userId: string
  sessionId: string
}

export function makeTools(ctx: ToolContext) {
  return {
    web_search: tool({
      description:
        "Search the public web for prospects matching the user's ICP. Returns name/title/company candidates. Use for 'find me X' style requests. Always show a sample before recommending bulk enrichment.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Concise search query, e.g. 'head of marketing fintech startup India site:linkedin.com/in'",
          ),
        target_role: z.string().optional(),
        industry: z.string().optional(),
        location: z.string().optional(),
        max_results: z.number().int().min(5).max(50).default(15),
      }),
      execute: async (params) => handleWebSearch(params, ctx),
    }),

    public_source_search: tool({
      description:
        "Search vertical-specific public APIs (GitHub, ProductHunt, HN Algolia) for prospects. Use when the ICP is developers, makers, or indie hackers.",
      inputSchema: z.object({
        source: z.enum(["github", "producthunt", "hn_algolia"]),
        query: z.string(),
        max_results: z.number().int().min(5).max(50).default(15),
      }),
      execute: async (params) => handlePublicSourceSearch(params, ctx),
    }),

    enrich_prospect: tool({
      description:
        "Deeply enrich a single named prospect: research summary + personalized cold email + 3 talking points. Returns inline within ~15 seconds.",
      inputSchema: z.object({
        name: z.string(),
        company: z.string().optional(),
        company_domain: z.string().optional(),
        linkedin_url: z.string().url().optional(),
      }),
      execute: async (params) => handleEnrichProspect(params, ctx),
    }),

    clarify_question: tool({
      description:
        "Ask the user a focused clarifying question. Use sparingly — only when the request is genuinely too vague to act on.",
      inputSchema: z.object({
        question: z.string(),
        suggested_answers: z.array(z.string()).optional(),
      }),
      execute: async (params) => handleClarify(params),
    }),

    add_named_prospects: tool({
      description:
        "Stage a list of explicitly-named prospects (no web search) for enrichment. Use when the user pastes or types out a list like 'Priya at Razorpay, Rahul at Freshworks, Tanvir at Postman'. After staging, confirm scope and then call start_bulk_job.",
      inputSchema: z.object({
        prospects: z
          .array(
            z.object({
              name: z.string(),
              company: z.string().optional(),
              title: z.string().optional(),
              linkedin_url: z.string().url().optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
      execute: async (params) => handleAddNamedProspects(params, ctx),
    }),

    start_bulk_job: tool({
      description:
        "Kick off bulk enrichment for previously-surfaced candidates. Output: a Google Sheet (if Google connected) plus a downloadable CSV. ONLY call after the user explicitly confirms scope.",
      inputSchema: z.object({
        candidate_ids: z.array(z.string().uuid()).optional(),
        draft_email: z.boolean().default(true),
      }),
      execute: async (params) => handleStartBulkJob(params, ctx),
    }),

    launch_campaign: tool({
      description:
        "Launch an outbound campaign: queue the drafted emails from a completed bulk job to send from the user's connected Gmail mailbox. Respects warm-up caps, send windows, and the suppression list. ONLY call after the user explicitly confirms they want to start sending real emails. Requires a connected mailbox (Settings → Mailboxes).",
      inputSchema: z.object({
        name: z.string().describe("A name for this campaign."),
        job_id: z
          .string()
          .uuid()
          .optional()
          .describe("Source job. Defaults to the most recent completed job."),
        mailbox_id: z
          .string()
          .uuid()
          .optional()
          .describe("Sending mailbox. Defaults to the user's active mailbox."),
        sequence_id: z
          .string()
          .uuid()
          .optional()
          .describe("Optional sequence to associate (for future multi-step sends)."),
      }),
      execute: async (params) => handleLaunchCampaign(params, ctx),
    }),
  }
}
