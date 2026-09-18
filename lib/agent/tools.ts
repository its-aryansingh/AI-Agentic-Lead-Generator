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

import { tool, type ToolSet } from "ai";
import { z } from "zod";

import {
  handleAddNamedProspects,
  handleClarify,
  handleDraftReply,
  handleEnrichIntakeJob,
  handleEnrichLead,
  handleEnrichProspect,
  handleLaunchCampaign,
  handleListIntakeJobs,
  handlePublicSourceSearch,
  handlePushToCrm,
  handleSearchLeads,
  handleSaveCandidatesToLeads,
  handleStartBulkJob,
  handleWebSearch,
} from "@/lib/agent/tool-handlers";

export interface ToolContext {
  userId: string;
  sessionId: string;
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
  });

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
  });

export const enrichProspectTool = (ctx: ToolContext) =>
  tool({
    description:
      "Deeply enrich a single named prospect: research summary + personalized cold email + 3 talking points. Returns inline within ~15 seconds.",
    inputSchema: z.object({
      name: z.string(),
      title: z.string().optional(),
      company: z.string().optional(),
      company_domain: z.string().optional(),
      linkedin_url: z.string().url().optional(),
    }),
    execute: async (params) => handleEnrichProspect(params, ctx),
  });

export const saveCandidatesToLeadsTool = (ctx: ToolContext) =>
  tool({
    description:
      "Save discovered or explicitly named prospects into the user's Leads section without enrichment or credit usage. You MUST call this before claiming that candidates were added to Leads.",
    inputSchema: z.object({
      prospects: z
        .array(
          z.object({
            name: z.string().min(1),
            company: z.string().optional(),
            title: z.string().optional(),
            linkedin_url: z.string().url().optional(),
          }),
        )
        .min(1)
        .max(50),
    }),
    execute: async (params) => handleSaveCandidatesToLeads(params, ctx),
  });

export const clarifyTool = (_ctx: ToolContext) =>
  tool({
    description:
      "Ask the user a focused clarifying question. Use sparingly — only when the request is genuinely too vague to act on.",
    inputSchema: z.object({
      question: z.string(),
      suggested_answers: z.array(z.string()).optional(),
    }),
    execute: async (params) => handleClarify(params),
  });

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
  });

export const startBulkJobTool = (ctx: ToolContext) =>
  tool({
    description:
      "Kick off bulk enrichment for previously-surfaced candidates. Output: a Google Sheet (if Google connected) plus a downloadable CSV. ONLY call after the user explicitly confirms scope.",
    inputSchema: z.object({
      candidate_ids: z.array(z.string().uuid()).optional(),
      draft_email: z.boolean().default(true),
    }),
    execute: async (params) => handleStartBulkJob(params, ctx),
  });

export const launchCampaignTool = (ctx: ToolContext) =>
  tool({
    description:
      "Launch an outbound campaign on EMAIL (default) or WHATSAPP. Email: queues and sends drafted emails from the user's connected Gmail mailbox. WhatsApp: sends a pre-approved template. ONLY call after the user explicitly confirms they want to start sending real messages.",
    inputSchema: z.object({
      name: z
        .string()
        .default("Outreach Campaign")
        .optional()
        .describe("A name for this campaign (optional)."),
      job_id: z
        .string()
        .optional()
        .describe("Source job. Defaults to the most recent completed job."),
      lead_id: z
        .string()
        .optional()
        .describe("Optional single lead ID or lead name to send to."),
      lead_name: z
        .string()
        .optional()
        .describe(
          "Optional name of the lead (e.g. 'Tester') if lead_id is not known.",
        ),
      sequence_id: z
        .string()
        .optional()
        .describe(
          "Optional sequence to associate (for future multi-step sends).",
        ),
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
          "Pre-approved WhatsApp template name (e.g. 'cold_outreach_v1'). REQUIRED when channel='whatsapp'.",
        ),
      whatsapp_language: z
        .string()
        .optional()
        .describe(
          "Template language code (e.g. 'en', 'hi', 'en_US'). Defaults to 'en'. Used only when channel='whatsapp'.",
        ),
    }),
    execute: async (params) => handleLaunchCampaign(params, ctx),
  });

export const pushToCrmTool = (ctx: ToolContext) =>
  tool({
    description:
      "Push enriched prospects from a completed bulk job into a CRM (HubSpot or Zoho) — upsert contact by email, optionally attach the research summary + drafted email as a Note. Use AFTER a job completes — typically as the last step of a campaign so reps can pick up follow-ups in their CRM. Mock-safe when the chosen CRM's keys are not configured.",
    inputSchema: z.object({
      job_id: z
        .string()
        .uuid()
        .optional()
        .describe("Source job. Defaults to the most recent completed job."),
      include_note: z
        .boolean()
        .default(true)
        .describe(
          "Attach the research summary + drafted email as a Note on each contact.",
        ),
      crm: z
        .enum(["hubspot", "zoho"])
        .default("hubspot")
        .describe(
          "Which CRM to push to. 'hubspot' (default) uses HUBSPOT_API_KEY; 'zoho' uses ZOHO_REFRESH_TOKEN + ZOHO_CLIENT_ID + ZOHO_CLIENT_SECRET (+ optional ZOHO_REGION, default 'com', use 'in' for India accounts).",
        ),
    }),
    execute: async (params) => handlePushToCrm(params, ctx),
  });

export const draftReplyTool = (ctx: ToolContext) =>
  tool({
    description:
      "Draft a contextual response to a hot inbound reply. Reads the reply, the original outbound, and the prospect; returns a tight subject + body + intended next_step. Does NOT send — the user always reviews + presses the final button. Use AFTER the user asks for help responding to a specific reply they're looking at in the Inbox.",
    inputSchema: z.object({
      reply_classification_id: z
        .string()
        .uuid()
        .describe(
          "The reply_classifications row id (from the Inbox / hot-reply alert).",
        ),
    }),
    execute: async (params) => handleDraftReply(params, ctx),
  });

export const listIntakeJobsTool = (ctx: ToolContext) =>
  tool({
    description:
      "List leads that were added via Lead Intake (manual entry or CSV upload) and have not yet been enriched with a drafted email. Use this when the user says they added leads via Lead Intake and wants to send emails — check here first to find the job_id, then call enrich_intake_job.",
    inputSchema: z.object({}),
    execute: async () => handleListIntakeJobs(ctx),
  });

export const enrichIntakeJobTool = (ctx: ToolContext) =>
  tool({
    description:
      "Enrich and draft cold emails for leads that were added via Lead Intake (manual entry or CSV). Takes the job_id from list_intake_jobs. Updates the existing prospect rows in-place with research summary + personalized email subject/body, then marks the job ready for launch_campaign. Always call this before launch_campaign when the source is Lead Intake.",
    inputSchema: z.object({
      job_id: z
        .string()
        .uuid()
        .describe(
          "The intake job ID (from list_intake_jobs or the URL /app/jobs/[id]).",
        ),
      draft_email: z
        .boolean()
        .default(true)
        .describe(
          "Whether to also AI-draft a personalized cold email (default: true).",
        ),
    }),
    execute: async (params) => handleEnrichIntakeJob(params, ctx),
  });

export const searchLeadsTool = (ctx: ToolContext) =>
  tool({
    description:
      "Search the user's existing leads in the database by name, company, email, status (e.g. 'qualified', 'contacted'), qualification bucket ('hot', 'warm'), or inbound replies. Always call this when the user asks about existing leads, pipeline status, recent replies, or qualified leads.",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe(
          "Search term to match against lead name, company, email, title, or reply content (e.g. 'Jane', 'Acme', 'qualified', 'replies').",
        ),
      lead_status: z
        .string()
        .optional()
        .describe(
          "Filter by lead status: 'new', 'contacted', 'engaged', 'qualified', 'disqualified', 'converted'.",
        ),
      qualification_bucket: z
        .string()
        .optional()
        .describe("Filter by qualification bucket: 'hot', 'warm', 'cold'."),
      only_with_replies: z
        .boolean()
        .optional()
        .describe(
          "Set to true whenever the request mentions replies, including compound requests such as qualified leads from recent replies.",
        ),
      limit: z.number().int().min(1).max(50).default(25).optional(),
    }),
    execute: async (params) => handleSearchLeads(params, ctx),
  });

export const enrichLeadTool = (ctx: ToolContext) =>
  tool({
    description:
      "Deeply enrich a single existing lead from the user's database and draft a personalized qualification/outreach email based on company context and playbook. Provide either lead_id (from search_leads) or the lead's name.",
    inputSchema: z.object({
      lead_id: z
        .string()
        .optional()
        .describe("The prospect ID or name from search_leads."),
      name: z
        .string()
        .optional()
        .describe("The name of the lead to enrich if lead_id is not known."),
      draft_email: z
        .boolean()
        .default(true)
        .describe("Whether to draft a personalized qualification email."),
    }),
    execute: async (params) => handleEnrichLead(params, ctx),
  });

/**
 * Registry of every tool factory by name. Specialists (specialists.ts)
 * select a subset by name from their catalog entry; makeTools binds them all.
 */
export const TOOL_FACTORIES: Record<
  string,
  (ctx: ToolContext) => ToolSet[string]
> = {
  web_search: webSearchTool,
  public_source_search: publicSourceSearchTool,
  enrich_prospect: enrichProspectTool,
  clarify_question: clarifyTool,
  add_named_prospects: addNamedProspectsTool,
  save_candidates_to_leads: saveCandidatesToLeadsTool,
  start_bulk_job: startBulkJobTool,
  launch_campaign: launchCampaignTool,
  push_to_crm: pushToCrmTool,
  draft_reply: draftReplyTool,
  list_intake_jobs: listIntakeJobsTool,
  enrich_intake_job: enrichIntakeJobTool,
  search_leads: searchLeadsTool,
  enrich_lead: enrichLeadTool,
};

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
    save_candidates_to_leads: saveCandidatesToLeadsTool(ctx),
    start_bulk_job: startBulkJobTool(ctx),
    launch_campaign: launchCampaignTool(ctx),
    push_to_crm: pushToCrmTool(ctx),
    draft_reply: draftReplyTool(ctx),
    list_intake_jobs: listIntakeJobsTool(ctx),
    enrich_intake_job: enrichIntakeJobTool(ctx),
    search_leads: searchLeadsTool(ctx),
    enrich_lead: enrichLeadTool(ctx),
  };
}
