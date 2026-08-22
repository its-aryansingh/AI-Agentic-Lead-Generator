import re
import os

def detects_booking_intent(body: str) -> bool:
    if not body: return False
    t = body.lower()
    return bool(re.search(r'\b(calendar|calendly|cal\.com|book.{0,15}meeting|book.{0,15}call|schedule.{0,15}(call|meeting|chat)|set.{0,15}up.{0,15}(call|meeting|chat)|when.{0,15}(are|you).{0,15}free|hop.{0,15}on.{0,15}call|jump.{0,15}on.{0,15}call|quick.{0,15}call|\b(15|20|30|45)\s*-?\s*min\b|monday|tuesday|wednesday|thursday|friday|next\s+week)\b', t))

def mock_classify(body: str) -> dict:
    t = body.lower()
    wants_meeting = detects_booking_intent(body)
    if re.search(r'unsubscribe|remove me|stop emailing|take me off|do not contact', t):
        return {"category": "unsubscribe", "confidence": 0.95, "reasoning": "Explicit removal request (mock).", "wants_meeting": False}
    if re.search(r'out of office|on vacation|away until|automatic reply|auto-reply', t):
        return {"category": "out_of_office", "confidence": 0.95, "reasoning": "Automated away message (mock).", "wants_meeting": False}
    if re.search(r'not interested|no thanks|we\'re good|pass\b|not a fit', t):
        return {"category": "not_interested", "confidence": 0.8, "reasoning": "Clear decline (mock).", "wants_meeting": False}
    if re.search(r'interested|let\'s talk|book|call|demo|sounds good|keen|happy to chat', t):
        return {"category": "interested", "confidence": 0.8, "reasoning": "Positive engagement signal (mock).", "wants_meeting": wants_meeting}
    if re.search(r'how much|pricing|price|cost|how does it work|tell me more|what is|can you', t):
        return {"category": "question", "confidence": 0.75, "reasoning": "Asking for info (mock).", "wants_meeting": wants_meeting}
    if re.search(r'already use|bad timing|not the right|wrong person|busy right now', t):
        return {"category": "objection", "confidence": 0.7, "reasoning": "Engaged pushback (mock).", "wants_meeting": wants_meeting}
    return {"category": "other", "confidence": 0.4, "reasoning": "No clear signal (mock).", "wants_meeting": wants_meeting}

async def classify_reply(body: str, subject: str = "") -> dict:
    if not os.getenv("ANTHROPIC_API_KEY"):
        return mock_classify(body)
    
    # Python equivalent would hit Claude for structured parsing.
    # For now, we retain the mock logic as the base.
    return mock_classify(body)

def needs_human(category: str) -> bool:
    return category in ("interested", "question", "objection")
