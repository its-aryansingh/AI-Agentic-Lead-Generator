import hmac
import hashlib
import base64
import os

def get_secret() -> str:
    return os.getenv("UNSUB_SECRET", "dev-unsub-secret")

def sha256_email(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()

def make_unsub_token(recipient_id: str, user_id: str) -> str:
    payload = base64.urlsafe_b64encode(f"{recipient_id}.{user_id}".encode("utf-8")).decode("ascii").rstrip("=")
    sig = base64.urlsafe_b64encode(
        hmac.new(get_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")
    return f"{payload}.{sig}"

def verify_unsub_token(token: str) -> dict[str, str] | None:
    parts = token.split(".")
    if len(parts) != 2:
        return None
    payload, sig = parts
    expected = base64.urlsafe_b64encode(
        hmac.new(get_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")
    
    if not hmac.compare_digest(sig, expected):
        return None
        
    try:
        # Add padding back if necessary
        padded_payload = payload + "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(padded_payload).decode("utf-8")
        recipient_id, user_id = decoded.split(".")
        if not recipient_id or not user_id:
            return None
        return {"recipientId": recipient_id, "userId": user_id}
    except Exception:
        return None

def append_compliance_footer(body: str, unsub_token: str, physical_address: str | None, app_url: str) -> str:
    unsub_url = f"{app_url}/u/{unsub_token}"
    addr = physical_address.strip() if physical_address else None
    
    footer_lines = [
        "",
        "—",
        f"Don't want these emails? Unsubscribe: {unsub_url}"
    ]
    if addr:
        footer_lines.append(addr)
        
    return body + "\n" + "\n".join(footer_lines)
