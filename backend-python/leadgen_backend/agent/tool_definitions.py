"""
Tool definitions — JSON schemas for Claude tool_use API.

Mirrors lib/agent/tools.ts. Each tool definition is a dict compatible
with the Anthropic Messages API `tools` parameter.
"""
from __future__ import annotations

from typing import Any


def _tool(name: str, description: str, input_schema: dict[str, Any]) -> dict[str, Any]:
    return {"name": name, "description": description, "input_schema": input_schema}


WEB_SEARCH_TOOL = _tool(
    "web_search",
    "Search the public web for prospects matching the user's ICP. Returns name/title/company candidates. "
    "Use for 'find me X' style requests. Always show a sample before recommending bulk enrichment.",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Concise search query"},
            "target_role": {"type": "string"},
            "industry": {"type": "string"},
            "location": {"type": "string"},
            "max_results": {"type": "integer", "minimum": 5, "maximum": 50, "default": 15},
        },
        "required": ["query"],
    },
)

PUBLIC_SOURCE_SEARCH_TOOL = _tool(
    "public_source_search",
    "Search vertical-specific public APIs (GitHub, ProductHunt, HN Algolia) for prospects. "
    "Use when the ICP is developers, makers, or indie hackers.",
    {
        "type": "object",
        "properties": {
            "source": {"type": "string", "enum": ["github", "producthunt", "hn_algolia"]},
            "query": {"type": "string"},
            "max_results": {"type": "integer", "minimum": 5, "maximum": 50, "default": 15},
        },
        "required": ["source", "query"],
    },
)

ENRICH_PROSPECT_TOOL = _tool(
    "enrich_prospect",
    "Deeply enrich a single named prospect: research summary + personalized cold email + 3 talking points. "
    "Returns inline within ~15 seconds.",
    {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "company": {"type": "string"},
            "company_domain": {"type": "string"},
            "linkedin_url": {"type": "string"},
        },
        "required": ["name"],
    },
)

CLARIFY_TOOL = _tool(
    "clarify_question",
    "Ask the user a focused clarifying question. Use sparingly — only when the request is genuinely too vague to act on.",
    {
        "type": "object",
        "properties": {
            "question": {"type": "string"},
            "suggested_answers": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["question"],
    },
)

ADD_NAMED_PROSPECTS_TOOL = _tool(
    "add_named_prospects",
    "Stage a list of explicitly-named prospects (no web search) for enrichment. "
    "Use when the user pastes or types out a list. After staging, confirm scope and then call start_bulk_job.",
    {
        "type": "object",
        "properties": {
            "prospects": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "company": {"type": "string"},
                        "title": {"type": "string"},
                        "linkedin_url": {"type": "string"},
                    },
                    "required": ["name"],
                },
                "minItems": 1,
                "maxItems": 100,
            }
        },
        "required": ["prospects"],
    },
)

START_BULK_JOB_TOOL = _tool(
    "start_bulk_job",
    "Kick off bulk enrichment for previously-surfaced candidates. "
    "Output: a Google Sheet (if Google connected) plus a downloadable CSV. "
    "ONLY call after the user explicitly confirms scope.",
    {
        "type": "object",
        "properties": {
            "candidate_ids": {"type": "array", "items": {"type": "string"}},
            "draft_email": {"type": "boolean", "default": True},
        },
    },
)

LAUNCH_CAMPAIGN_TOOL = _tool(
    "launch_campaign",
    "Launch an outbound campaign on EMAIL (default) or WHATSAPP. "
    "ONLY call after the user explicitly confirms they want to start sending real messages.",
    {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "job_id": {"type": "string"},
            "mailbox_id": {"type": "string"},
            "sequence_id": {"type": "string"},
            "channel": {"type": "string", "enum": ["email", "whatsapp"], "default": "email"},
            "whatsapp_template": {"type": "string"},
            "whatsapp_language": {"type": "string"},
        },
        "required": ["name"],
    },
)

PUSH_TO_CRM_TOOL = _tool(
    "push_to_crm",
    "Push enriched prospects from a completed bulk job into a CRM (HubSpot or Zoho). "
    "Mock-safe when the chosen CRM's keys are not configured.",
    {
        "type": "object",
        "properties": {
            "job_id": {"type": "string"},
            "include_note": {"type": "boolean", "default": True},
            "crm": {"type": "string", "enum": ["hubspot", "zoho"], "default": "hubspot"},
        },
    },
)

DRAFT_REPLY_TOOL = _tool(
    "draft_reply",
    "Draft a contextual response to a hot inbound reply. "
    "Does NOT send — the user always reviews + presses the final button.",
    {
        "type": "object",
        "properties": {
            "reply_classification_id": {"type": "string"},
        },
        "required": ["reply_classification_id"],
    },
)

ALL_TOOLS = [
    WEB_SEARCH_TOOL,
    PUBLIC_SOURCE_SEARCH_TOOL,
    ENRICH_PROSPECT_TOOL,
    CLARIFY_TOOL,
    ADD_NAMED_PROSPECTS_TOOL,
    START_BULK_JOB_TOOL,
    LAUNCH_CAMPAIGN_TOOL,
    PUSH_TO_CRM_TOOL,
    DRAFT_REPLY_TOOL,
]
