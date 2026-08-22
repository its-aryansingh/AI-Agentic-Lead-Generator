import hmac
import hashlib
import json
import re
from typing import Any

OPT_OUT_KEYWORDS = {
    "stop",
    "unsubscribe",
    "optout",
    "opt-out",
    "opt out",
    "cancel",
    "end",
    "quit",
}

PLANS = {
    "free": {"name": "Free", "credits": 25, "priceInr": 0, "priceUsd": 0},
    "starter": {"name": "Starter", "credits": 1000, "priceInr": 2499, "priceUsd": 29},
    "pro": {"name": "Pro", "credits": 5000, "priceInr": 6999, "priceUsd": 79},
    "agency": {"name": "Agency", "credits": 20000, "priceInr": 14999, "priceUsd": 149},
}

def verify_razorpay_signature(body: bytes, signature: str, secret: str) -> bool:
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)

def verify_whatsapp_signature(body: bytes, header_flat: str | None, header_hub: str | None, secret: str) -> bool:
    if not secret:
        return False
    if header_flat and hmac.compare_digest(header_flat, secret):
        return True
    if header_hub and header_hub.startswith("sha256="):
        expected = "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(header_hub, expected)
    return False

def is_opt_out_text(text: str) -> bool:
    trimmed = text.strip().lower()
    if not trimmed:
        return False
    if trimmed in OPT_OUT_KEYWORDS:
        return True
    # Match first token
    tokens = re.split(r'[\s\W]+', trimmed)
    first_token = tokens[0] if tokens else ""
    return first_token in OPT_OUT_KEYWORDS

def normalize_whatsapp_payload(raw: Any) -> dict[str, list[dict[str, Any]]]:
    messages = []
    statuses = []
    if not isinstance(raw, dict):
        return {"messages": messages, "statuses": statuses}
    
    candidates = []
    entries = raw.get("entry", [])
    if isinstance(entries, list):
        for entry in entries:
            if isinstance(entry, dict):
                changes = entry.get("changes", [])
                if isinstance(changes, list):
                    for c in changes:
                        if isinstance(c, dict) and isinstance(c.get("value"), dict):
                            candidates.append(c["value"])
    
    candidates.append(raw)

    for obj in candidates:
        if not isinstance(obj, dict):
            continue
        
        msgs = obj.get("messages", [])
        if isinstance(msgs, list):
            for m in msgs:
                if not isinstance(m, dict):
                    continue
                msg_id = m.get("id", "")
                from_ = m.get("from", "")
                if not isinstance(msg_id, str): msg_id = ""
                if not isinstance(from_, str): from_ = ""
                
                text = ""
                txt_field = m.get("text")
                if isinstance(txt_field, str):
                    text = txt_field
                elif isinstance(txt_field, dict) and isinstance(txt_field.get("body"), str):
                    text = txt_field["body"]
                elif isinstance(m.get("body"), str):
                    text = m["body"]
                
                if msg_id and from_:
                    messages.append({"id": msg_id, "from": from_, "text": text})

        sts = obj.get("statuses", [])
        if isinstance(sts, list):
            for s in sts:
                if not isinstance(s, dict):
                    continue
                st_id = s.get("id", "")
                status = s.get("status", "")
                if not isinstance(st_id, str): st_id = ""
                if not isinstance(status, str): status = ""
                
                recipient_id = s.get("recipient_id") if isinstance(s.get("recipient_id"), str) else None
                reason = None
                if isinstance(s.get("reason"), str):
                    reason = s["reason"]
                elif isinstance(s.get("errors"), list) and s["errors"]:
                    reason = json.dumps(s["errors"][0])
                
                if st_id and status:
                    statuses.append({"id": st_id, "status": status, "recipient_id": recipient_id, "reason": reason})

    # Dedupe
    seen_msg = set()
    deduped_messages = []
    for m in messages:
        if m["id"] not in seen_msg:
            seen_msg.add(m["id"])
            deduped_messages.append(m)
            
    seen_st = set()
    deduped_statuses = []
    for s in statuses:
        k = f"{s['id']}:{s['status']}"
        if k not in seen_st:
            seen_st.add(k)
            deduped_statuses.append(s)
            
    return {"messages": deduped_messages, "statuses": deduped_statuses}
