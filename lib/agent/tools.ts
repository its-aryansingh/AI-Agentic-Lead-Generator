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
  callDetailsSchema,
  crmSyncSchema,
  followupSchema,
  leadFiltersSchema,
  qualificationBatchSchema,
  triggerOutreachSchema,
  voiceAgentSchema,
} from "@/lib/agent/sales-tool-schemas";

// Keep the schema-only tool definitions importable by Node's native test
// runner. The server-only handlers use Next aliases and load only when an
// authenticated tool invocation actually executes.
const loadToolHandlers = () => import("./tool-handlers");

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
      max_results: z.number().int().min(1).max(50).default(25),
    }),
    execute: async (params) =>
      (await loadToolHandlers()).handleWebSearch(params, ctx),
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
    execute: async (params) =>
      (await loadToolHandlers()).handlePublicSourceSearch(params, ctx),
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
    execute: async (params) =>
      (await loadToolHandlers()).handleEnrichProspect(params, ctx),
  });

export const saveCandidatesToLeadsTool = (ctx: ToolContext) =>
  tool({
    description:
      "Save discovered or explicitly named prospects into the user's Leads section without enrichment or credit usage. Can save an explicit array of prospects, or set save_all_staged: true to commit all candidates found in this session.",
    inputSchema: z.object({
      prospects: z
        .array(
          z.object({
            name: z.string().min(1),
            company: z.string().optional(),
            title: z.string().optional(),
            linkedin_url: z.string().url().optional(),
            company_domain: z.string().optional(),
          }),
        )
        .max(50)
        .optional(),
      save_all_staged: z
        .boolean()
        .optional()
        .describe(
          "Set to true to commit all staged prospect candidates discovered during this chat session into the Leads table.",
        ),
    }),
    execute: async (params) =>
      (await loadToolHandlers()).handleSaveCandidatesToLeads(params, ctx),
  });

export const clarifyTool = (_ctx: ToolContext) =>
  tool({
    description:
      "Ask the user a focused clarifying question. Use sparingly — only when the request is genuinely too vague to act on.",
    inputSchema: z.object({
      question: z.string(),
      suggested_answers: z.array(z.string()).optional(),
    }),
    execute: async (params) => (await loadToolHandlers()).handleClarify(params),
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
    execute: async (params) =>
      (await loadToolHandlers()).handleAddNamedProspects(params, ctx),
  });

export const startBulkJobTool = (ctx: ToolContext) =>
  tool({
    description:
      "Kick off bulk enrichment for previously-surfaced candidates. Output: a Google Sheet (if Google connected) plus a downloadable CSV. ONLY call after the user explicitly confirms scope.",
    inputSchema: z.object({
      candidate_ids: z.array(z.string().uuid()).optional(),
      draft_email: z.boolean().default(true),
    }),
    execute: async (params) =>
      (await loadToolHandlers()).handleStartBulkJob(params, ctx),
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
    execute: async (params) =>
      (await loadToolHandlers()).handleLaunchCampaign(params, ctx),
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
    execute: async (params) =>
      (await loadToolHandlers()).handlePushToCrm(params, ctx),
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
    execute: async (params) =>
      (await loadToolHandlers()).handleDraftReply(params, ctx),
  });

export const listIntakeJobsTool = (ctx: ToolContext) =>
  tool({
    description:
      "List leads that were added via Lead Intake (manual entry or CSV upload) and have not yet been enriched with a drafted email. Use this when the user says they added leads via Lead Intake and wants to send emails — check here first to find the job_id, then call enrich_intake_job.",
    inputSchema: z.object({}),
    execute: async () => (await loadToolHandlers()).handleListIntakeJobs(ctx),
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
    execute: async (params) =>
      (await loadToolHandlers()).handleEnrichIntakeJob(params, ctx),
  });

export const searchLeadsTool = (ctx: ToolContext) =>
  tool({
    description:
      "Search and filter the user's existing leads in the database. Supports filtering by name/company/email query, call status (e.g. uncalled or unanswered leads), date added (e.g. added today), lead status, and replies. Always use this when the user asks to find, list, or call existing leads.",
    inputSchema: leadFiltersSchema,
    execute: async (params) =>
      (await loadToolHandlers()).handleSearchLeads(params, ctx),
  });

export const createOrUpdateVoiceAgentTool = (ctx: ToolContext) =>
  tool({
    description:
      "Preview a managed Bolna qualification-agent configuration. Only the confirmation card can apply it; provider credentials remain server-side.",
    inputSchema: voiceAgentSchema,
    execute: async (params) =>
      (await loadToolHandlers()).handleCreateOrUpdateVoiceAgent(params, ctx),
  });

export const startQualificationCallsBatchTool = (ctx: ToolContext) =>
  tool({
    description:
      "Preview the exact eligible and blocked lead set for qualification calls. Applying requires the dedicated confirmation card and never bypasses DNC, consent, phone validity, or calling hours.",
    inputSchema: qualificationBatchSchema,
    execute: async (params) =>
      (await loadToolHandlers()).handleStartQualificationCallsBatch(
        params,
        ctx,
      ),
  });

export const scheduleLeadFollowupTool = (ctx: ToolContext) =>
  tool({
    description:
      "Preview an idempotent email or voice follow-up at an IANA-timezone-aware time. Applying requires the confirmation card.",
    inputSchema: followupSchema,
    execute: async (params) =>
      (await loadToolHandlers()).handleScheduleLeadFollowup(params, ctx),
  });

export const syncCrmLeadsTool = (ctx: ToolContext) =>
  tool({
    description:
      "Preview a pull from the tenant's connected HubSpot or Zoho CRM and show created, updated, and skipped estimates. Applying requires the confirmation card.",
    inputSchema: crmSyncSchema,
    execute: async (params) =>
      (await loadToolHandlers()).handleSyncCrmLeads(params, ctx),
  });

export const getCallDetailsAndAnalyticsTool = (ctx: ToolContext) =>
  tool({
    description:
      "Read tenant-scoped call details and analytics, including actual transcript, recording availability, outcomes, and Bolna provider costs. Never invent unavailable data.",
    inputSchema: callDetailsSchema,
    execute: async (params) =>
      (await loadToolHandlers()).handleGetCallDetailsAndAnalytics(params, ctx),
  });

export const triggerOutreachRunTool = (ctx: ToolContext) =>
  tool({
    description:
      "Preview exact outreach leads, channels, skips, platform-credit estimate, and approval requirements. Applying requires the confirmation card.",
    inputSchema: triggerOutreachSchema,
    execute: async (params) =>
      (await loadToolHandlers()).handleTriggerOutreachRun(params, ctx),
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
    execute: async (params) =>
      (await loadToolHandlers()).handleEnrichLead(params, ctx),
  });

export const enrichProspectsPublicTool = (ctx: ToolContext) =>
  tool({
    description:
      "Crawl company websites using headless Playwright browser and OpenAI to extract public Indian phone numbers (+91), verified business emails, social links, and key people. Can enrich staged candidates from discovery, 1 lead, multiple lead IDs, or all un-enriched leads in the database.",
    inputSchema: z.object({
      enrich_staged: z
        .boolean()
        .optional()
        .describe(
          "Set to true to crawl websites and enrich all prospect candidates currently staged in the chat discovery session.",
        ),
      lead_ids: z
        .array(z.string())
        .optional()
        .describe("List of lead/prospect IDs to enrich via web scraper."),
      lead_id: z
        .string()
        .optional()
        .describe("Single lead ID or name to enrich."),
      domain: z
        .string()
        .optional()
        .describe("Company domain to crawl (e.g. 'vrlgroup.in')."),
      query: z
        .string()
        .optional()
        .describe(
          "Search term to find leads in database to enrich, e.g. 'transport'.",
        ),
      all_unenriched: z
        .boolean()
        .optional()
        .describe("Set to true to enrich all un-enriched leads in database."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .optional()
        .describe("Max number of leads to enrich when matching multiple."),
    }),
    execute: async (params) =>
      (await loadToolHandlers()).handleEnrichProspectsPublic(params, ctx),
  });

export const startQualificationCallTool = (ctx: ToolContext) =>
  tool({
    description:
      "Start one real AI qualification call for an existing lead. First resolve an exact lead_id with search_leads. Use only after the user explicitly asks to call that lead and confirms lawful permission in the conversation.",
    inputSchema: z.object({
      lead_id: z
        .string()
        .uuid()
        .describe("Exact owned lead ID from search_leads."),
      confirmed_lawful_permission: z
        .boolean()
        .describe(
          "True only when the user explicitly confirmed lawful permission to call in this conversation. Never infer it.",
        ),
      allow_override: z
        .boolean()
        .optional()
        .describe(
          "Only for an explicitly approved Call Again request; it never bypasses compliance.",
        ),
      override_reason: z.string().min(10).max(500).optional(),
      approval_id: z
        .string()
        .uuid()
        .optional()
        .describe(
          "Server-created, confirmed approval for this exact Call Again request.",
        ),
      idempotency_key: z.string().min(1).max(200).optional(),
    }),
    execute: async (params) =>
      (await loadToolHandlers()).handleStartQualificationCall(params, ctx),
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
  create_or_update_voice_agent: createOrUpdateVoiceAgentTool,
  start_qualification_calls_batch: startQualificationCallsBatchTool,
  schedule_lead_followup: scheduleLeadFollowupTool,
  sync_crm_leads: syncCrmLeadsTool,
  get_call_details_and_analytics: getCallDetailsAndAnalyticsTool,
  trigger_outreach_run: triggerOutreachRunTool,
  enrich_lead: enrichLeadTool,
  enrich_prospects_public: enrichProspectsPublicTool,
  start_qualification_call: startQualificationCallTool,
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
    create_or_update_voice_agent: createOrUpdateVoiceAgentTool(ctx),
    start_qualification_calls_batch: startQualificationCallsBatchTool(ctx),
    schedule_lead_followup: scheduleLeadFollowupTool(ctx),
    sync_crm_leads: syncCrmLeadsTool(ctx),
    get_call_details_and_analytics: getCallDetailsAndAnalyticsTool(ctx),
    trigger_outreach_run: triggerOutreachRunTool(ctx),
    enrich_lead: enrichLeadTool(ctx),
    enrich_prospects_public: enrichProspectsPublicTool(ctx),
    start_qualification_call: startQualificationCallTool(ctx),
  };
}
