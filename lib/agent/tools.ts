/**
 * Chat agent tools — Vercel AI SDK tool definitions.
 *
 * Each tool is a thin wrapper that calls into a tool-handler. The handlers
 * live in tool-handlers.ts so they can be exercised independently in tests.
 *
 * The handler functions take { userId, sessionId } as context the chat
 * route passes in — never trust the model to provide these.
 *
 * Tools are exposed both as individual factories (so specialist sub-agents
 * can take a focused subset — see specialists.ts) and bundled via
 * makeTools() (the full set, preserved for backward-compatibility).
 */

import { tool, type ToolSet } from "ai"
import { z } from "zod"

import {
  handleAddNamedProspects,
  handleClarify,
  handleEnrichProspect,
  handleLaunchCampaign,
  handlePublicSourceSearch,
  handlePushToCrm,
  handleStartBulkJob,
  handleWebSearch,
} from "./tool-handlers"

export interface ToolContext {
  userId: string
  sessionId: string
}

// ---------------------------------------------------------------------
// Individual tool factories. Each takes the server-injected context and
// returns one AI SDK tool. Specialists compose subsets of these.
// ---------------------------------------------------------------------

export const webSearchTool = (ctx: ToolContext) =>
  tool({
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
  })

export const publicSourceSearchTool = (ctx: ToolContext) =>
  tool({
    description:
      "Search vertical-specific public APIs (GitHub, ProductHunt, HN Algolia) for prospects. Use when the ICP is developers, makers, or indie hackers.",
    inputSchema: z.object({
      source: z.enum(["github", "producthunt", "hn_algolia"]),
      query: z.string(),
      max_results: z.number().int().min(5).max(50).default(15),
    }),
    execute: async (params) => handlePublicSourceSearch(params, ctx),
  })

export const enrichProspectTool = (ctx: ToolContext) =>
  tool({
    description:
      "Deeply enrich a single named prospect: research summary + personalized cold email + 3 talking points. Returns inline within ~15 seconds.",
    inputSchema: z.object({
      name: z.string(),
      company: z.string().optional(),
      company_domain: z.string().optional(),
      linkedin_url: z.string().url().optional(),
    }),
    execute: async (params) => handleEnrichProspect(params, ctx),
  })

export const clarifyTool = (_ctx: ToolContext) =>
  tool({
    description:
      "Ask the user a focused clarifying question. Use sparingly — only when the request is genuinely too vague to act on.",
    inputSchema: z.object({
      question: z.string(),
      suggested_answers: z.array(z.string()).optional(),
    }),
    execute: async (params) => handleClarify(params),
  })

export const addNamedProspectsTool = (ctx: ToolContext) =>
  tool({
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
  })

export const startBulkJobTool = (ctx: ToolContext) =>
  tool({
    description:
      "Kick off bulk enrichment for previously-surfaced candidates. Output: a Google Sheet (if Google connected) plus a downloadable CSV. ONLY call after the user explicitly confirms scope.",
    inputSchema: z.object({
      candidate_ids: z.array(z.string().uuid()).optional(),
      draft_email: z.boolean().default(true),
    }),
    execute: async (params) => handleStartBulkJob(params, ctx),
  })

export const launchCampaignTool = (ctx: ToolContext) =>
  tool({
    description:
      "Launch an outbound campaign on EMAIL (default) or WHATSAPP. Email: queues drafted emails from a completed bulk job to send from the user's connected Gmail mailbox; respects warm-up caps, send windows, and the suppression list. WhatsApp: sends a pre-approved template to prospects who have a phone number and have not opted out — cold WhatsApp REQUIRES a template (business-initiated policy). ONLY call after the user explicitly confirms they want to start sending real messages.",
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
        .describe("Sending mailbox. Defaults to the user's active mailbox. Email-only."),
      sequence_id: z
        .string()
        .uuid()
        .optional()
        .describe("Optional sequence to associate (for future multi-step sends)."),
      channel: z
        .enum(["email", "whatsapp"])
        .default("email")
        .describe(
          "Outbound channel. 'email' (default) sends via Gmail. 'whatsapp' sends a pre-approved template via the configured BSP — required for cold WhatsApp outreach.",
        ),
      whatsapp_template: z
        .string()
        .optional()
        .describe(
          "Pre-approved WhatsApp template name (e.g. 'cold_outreach_v1'). REQUIRED when channel='whatsapp'. The template's {{1}}…{{N}} placeholders are filled with [first_name, company] in that order.",
        ),
      whatsapp_language: z
        .string()
        .optional()
        .describe(
          "Template language code (e.g. 'en', 'hi', 'en_US'). Defaults to 'en'. Used only when channel='whatsapp'.",
        ),
    }),
    execute: async (params) => handleLaunchCampaign(params, ctx),
  })

export const pushToCrmTool = (ctx: ToolContext) =>
  tool({
    description:
      "Push enriched prospects from a completed bulk job into HubSpot CRM (upsert contact by email, optionally attach the research summary + drafted email as a Note). Use AFTER a job completes — typically as the last step of a campaign so reps can pick up follow-ups in HubSpot. Mock-safe when HUBSPOT_API_KEY is not configured.",
    inputSchema: z.object({
      job_id: z
        .string()
        .uuid()
        .optional()
        .describe("Source job. Defaults to the most recent completed job."),
      include_note: z
        .boolean()
        .default(true)
        .describe("Attach the research summary + drafted email as a HubSpot Note on each contact."),
    }),
    execute: async (params) => handlePushToCrm(params, ctx),
  })

/**
 * Registry of every tool factory by name. Specialists (specialists.ts)
 * select a subset by name from their catalog entry; makeTools binds them all.
 */
export const TOOL_FACTORIES: Record<string, (ctx: ToolContext) => ToolSet[string]> = {
  web_search: webSearchTool,
  public_source_search: publicSourceSearchTool,
  enrich_prospect: enrichProspectTool,
  clarify_question: clarifyTool,
  add_named_prospects: addNamedProspectsTool,
  start_bulk_job: startBulkJobTool,
  launch_campaign: launchCampaignTool,
  push_to_crm: pushToCrmTool,
}

/**
 * The full tool set. Preserved for backward-compatibility and for any
 * single-agent path. The orchestrator (orchestrator-tools.ts) exposes
 * specialist delegations instead; specialists compose the factories above.
 */
export function makeTools(ctx: ToolContext): ToolSet {
  return {
    web_search: webSearchTool(ctx),
    public_source_search: publicSourceSearchTool(ctx),
    enrich_prospect: enrichProspectTool(ctx),
    clarify_question: clarifyTool(ctx),
    add_named_prospects: addNamedProspectsTool(ctx),
    start_bulk_job: startBulkJobTool(ctx),
    launch_campaign: launchCampaignTool(ctx),
    push_to_crm: pushToCrmTool(ctx),
  }
}
