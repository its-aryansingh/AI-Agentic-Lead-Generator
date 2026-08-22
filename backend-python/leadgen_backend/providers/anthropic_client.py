import os
import json
from typing import Any

def has_anthropic_key() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))

MODEL_EMAIL = "claude-3-7-sonnet-20250219"

SYSTEM_PROMPT_EMAIL = """You write cold outbound emails for B2B SaaS sellers in India and Southeast Asia.

ABSOLUTE RULES:
1. NEVER start an email with "I noticed", "I came across", "I was impressed by", or "I hope this email finds you well". These phrases are immediate red flags that mark you as AI/template spam.
2. The opener must be a specific, factual observation about THIS prospect — referencing their actual role, company, or what their company does. Generic praise is banned.
3. Body is ≤60 words. Single paragraph. One specific question or CTA at the end. No multi-paragraph monologues.
4. Subject line ≤50 chars. Lowercase first letter is fine. No emojis. No fake "Re:" or "Fwd:".
5. If you don't have enough specific info to write something concrete, say so honestly in the body rather than inventing details. Fabricated specifics destroy trust.

GOOD EXAMPLES:

Subject: question about Razorpay's outbound to mid-market
Body: Quick one — Razorpay's mid-market push this year has been visible (the Capital launch especially). Curious how you're approaching outbound to founders in 50-200 employee range, given how noisy their inboxes are. We've built a tool for Indian SMB sellers around exactly that problem; happy to share what's worked. Worth a 15-min call?

Subject: scaling marketing at a 600-person fintech
Body: Saw Freshworks crossed 65k customers last quarter — marketing org must be feeling the breadth. We work with Indian SaaS marketing leads on AI-personalized prospecting that doesn't read like ChatGPT slop. Reply rates 2-3x cold templates. Would 20 min next week be useful, or pass for now?

Subject: cold outreach for indian-saas niche
Body: Pesto's been hiring engineers from non-tier-1 colleges for three years now — interesting differentiation against the standard FAANG-aspiration pitch. We help India-focused founders run AI-personalized outreach. Curious if you've tried building a top-of-funnel for sales hiring this way. Open to a quick call?

Notice the patterns: a specific fact about the prospect, ONE clear question, no fluff. Match this register."""

SYSTEM_PROMPT_REPLY = """You draft replies to prospect responses on a B2B cold-outbound thread.

ABSOLUTE RULES:
1. NEVER open with "Thanks for the reply", "Appreciate you getting back", "I'm so glad", or any other transactional pleasantry. Jump straight to value or the next step.
2. Acknowledge what they actually said in ONE sentence — referencing the specific thing they wrote, not generic "thanks for sharing".
3. ONE next step. Don't multi-prong. If they sound interested, propose a 15-min slot. If they have a question, answer it tightly. If they object, address THAT objection.
4. ≤80 words. One paragraph or two short ones. No multi-paragraph monologues.
5. Calendar offers are best as a concrete proposal ("Wed or Thu 3-5pm IST?") not "let me know what works".
6. For "not_interested" / "unsubscribe" replies: do NOT draft a counter — return a polite acknowledgement that closes the loop. The next_step should be "close_lost".
7. For "out_of_office": next_step is "wait_for_them" and the body is a one-line "no rush, will follow up when you're back".

GOOD EXAMPLES:

Subject: Re: question about Razorpay's outbound
Body: Makes sense — the founder-segment noise is real, especially in Q4. We've handled exactly that with a Bangalore fintech last year (3 to 8 booked calls/wk by switching to event-triggered outreach). Wed or Thu 3-5pm IST for a 15-min walkthrough?
next_step: book_meeting

Subject: Re: scaling marketing at a 600-person fintech
Body: Fair question on the per-rep cost — it's ~$80/mo at your volume, undercut by reply-rate uplift in our beta. Happy to show the math on the call. Does Thursday 4pm IST work, or pick a slot here: [link].
next_step: answer_objection

Subject: Re: cold outreach for indian-saas niche
Body: No worries — not the right time is fine. I'll loop back in Q2; if priorities shift sooner, my line stays open.
next_step: close_lost

Notice: specific acknowledgement, one move, no fluff. Match this register."""


def mock_draft(prospect: dict[str, Any]) -> dict[str, Any]:
    name = prospect.get("name", "")
    first_name = name.split(" ")[0] if name else ""
    company = prospect.get("company", "(company)")
    title = prospect.get("title", "(title)")
    location = prospect.get("location", "")
    
    loc_str = f" ({location})" if location else ""
    return {
        "research_summary": f"{name} leads {title.lower()} at {company}{loc_str}. (Mock summary — set ANTHROPIC_API_KEY for real research.)",
        "email_subject": f"quick question about {company}'s outbound",
        "email_body": f"Hi {first_name} — {company}'s recent move into the mid-market space caught my eye. Curious how you're handling AI-personalized prospecting given how saturated inboxes are right now. We've built something India-focused around this exact problem. Worth a 15-min call?",
        "talking_points": [
            f"Reference {company}'s recent growth and how their outbound has scaled with it",
            f"Ask about the split between inbound vs outbound for their pipeline",
            f"Share one anonymized data point from another {'fintech' if 'fintech' in company.lower() else 'SaaS'} customer's reply-rate uplift",
        ],
    }

def mock_reply_draft(opts: dict[str, Any]) -> dict[str, Any]:
    name = opts.get("prospect", {}).get("name", "")
    first_name = name.split(" ")[0] if name else ""
    cat = opts.get("reply_category", "")
    original_subject = opts.get("original_subject", "")
    calendar_link = opts.get("calendar_url") or "[calendar link]"
    
    if cat in ("not_interested", "unsubscribe"):
        return {
            "subject": f"Re: {original_subject}",
            "body": f"Understood, {first_name} — no worries. I'll loop back in a few months; if anything shifts sooner, easy to reach me here. (Mock draft — set ANTHROPIC_API_KEY for real.)",
            "next_step": "close_lost",
        }
    if cat == "out_of_office":
        return {
            "subject": f"Re: {original_subject}",
            "body": f"No rush, {first_name} — will follow up when you're back. (Mock draft — set ANTHROPIC_API_KEY for real.)",
            "next_step": "wait_for_them",
        }
    if cat == "objection":
        return {
            "subject": f"Re: {original_subject}",
            "body": f"Fair point — happy to dig into that specifically on a quick call. Pick a slot here: {calendar_link} or Wed/Thu 3-5pm IST works too. (Mock draft — set ANTHROPIC_API_KEY for real.)",
            "next_step": "answer_objection",
        }
    return {
        "subject": f"Re: {original_subject}",
        "body": f"Great, {first_name} — easiest is a 15-min walkthrough. Grab a slot here: {calendar_link} (or Wed/Thu 3-5pm IST). (Mock draft — set ANTHROPIC_API_KEY for real.)",
        "next_step": "book_meeting",
    }


async def draft_for_prospect(opts: dict[str, Any]) -> dict[str, Any]:
    if not has_anthropic_key():
        return mock_draft(opts.get("prospect", {}))
        
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    
    prospect = opts.get("prospect", {})
    voice = opts.get("voiceAnchor")
    news = opts.get("news")
    lang = opts.get("language")
    
    parts = [
        f"Prospect: {prospect.get('name')}, {prospect.get('title')} at {prospect.get('company')}.",
    ]
    if prospect.get("location"):
        parts.append(f"Location: {prospect.get('location')}.")
    parts.append(f"Search snippet: {prospect.get('snippet')}")
    if news:
        parts.append(f"Recent company news: {news}")
    if lang and lang.lower() != "english":
        parts.append(f"Write the subject and email body in {lang}. Keep it natural and native — not a literal translation. Talking points may stay in English.")
    
    if voice:
        parts.append(f"Match this user's writing voice. Example email they wrote:\n{voice}")
    else:
        parts.append("Default voice: professional, warm, direct. Not corporate.")
        
    prompt = "\n".join(parts)
    
    schema = {
        "name": "email_draft",
        "description": "Output the email draft according to the schema",
        "input_schema": {
            "type": "object",
            "properties": {
                "research_summary": {"type": "string"},
                "email_subject": {"type": "string"},
                "email_body": {"type": "string"},
                "talking_points": {
                    "type": "array",
                    "items": {"type": "string"}
                }
            },
            "required": ["research_summary", "email_subject", "email_body", "talking_points"]
        }
    }
    
    msg = await client.messages.create(
        model=MODEL_EMAIL,
        max_tokens=1000,
        system=SYSTEM_PROMPT_EMAIL,
        messages=[{"role": "user", "content": prompt}],
        tools=[schema],
        tool_choice={"type": "tool", "name": "email_draft"}
    )
    
    for block in msg.content:
        if block.type == "tool_use" and block.name == "email_draft":
            return block.input
            
    return mock_draft(prospect)


async def draft_reply_response(opts: dict[str, Any]) -> dict[str, Any]:
    if not has_anthropic_key():
        return mock_reply_draft(opts)
        
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    
    prospect = opts.get("prospect", {})
    wants_meeting = opts.get("wants_meeting")
    calendar_url = opts.get("calendar_url")
    lang = opts.get("language")
    voice = opts.get("voiceAnchor")
    
    title_str = f", {prospect.get('title')}" if prospect.get('title') else ""
    company_str = f" at {prospect.get('company')}" if prospect.get('company') else ""
    
    parts = [
        f"Prospect: {prospect.get('name')}{title_str}{company_str}.",
        f"\nOriginal outbound:\nSubject: {opts.get('original_subject')}\n{opts.get('original_body')}",
        f"\nTheir reply (snippet): {opts.get('reply_snippet')}",
        f"\nClassifier category: {opts.get('reply_category')}{' (wants a meeting)' if wants_meeting else ''}",
    ]
    if calendar_url and wants_meeting:
        parts.append(f"\nUser's booking link (paste verbatim when offering a slot): {calendar_url}")
    if lang and lang.lower() != "english":
        parts.append(f"\nReply in {lang}. Natural register, not a literal translation.")
    if voice:
        parts.append(f"\nMatch this user's writing voice. Example:\n{voice}")
    else:
        parts.append("\nDefault voice: warm, direct, concrete. Not corporate. No filler.")
        
    prompt = "\n".join(parts)
    
    schema = {
        "name": "reply_draft",
        "description": "Output the reply draft",
        "input_schema": {
            "type": "object",
            "properties": {
                "subject": {"type": "string"},
                "body": {"type": "string"},
                "next_step": {
                    "type": "string",
                    "enum": ["book_meeting", "answer_objection", "send_info", "wait_for_them", "close_lost"]
                }
            },
            "required": ["subject", "body", "next_step"]
        }
    }
    
    msg = await client.messages.create(
        model=MODEL_EMAIL,
        max_tokens=1000,
        system=SYSTEM_PROMPT_REPLY,
        messages=[{"role": "user", "content": prompt}],
        tools=[schema],
        tool_choice={"type": "tool", "name": "reply_draft"}
    )
    
    for block in msg.content:
        if block.type == "tool_use" and block.name == "reply_draft":
            return block.input
            
    return mock_reply_draft(opts)
