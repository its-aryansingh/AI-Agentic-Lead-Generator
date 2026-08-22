from datetime import datetime, UTC
import os
import base64
import httpx

def google_configured() -> bool:
    return bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET"))

def build_raw_message(to: str, from_addr: str, subject: str, body: str) -> str:
    lines = [
        f"From: {from_addr}",
        f"To: {to}",
        f"Subject: {subject}",
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "",
        body,
    ]
    raw = "\r\n".join(lines)
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")
    return encoded.rstrip("=")

async def send_gmail(refresh_token: str, from_addr: str, to: str, subject: str, body: str) -> dict:
    if not google_configured() or refresh_token == "mock":
        id_ = f"mock-{int(datetime.now(UTC).timestamp())}"
        return {"messageId": id_, "threadId": id_, "mock": True}

    # Exchange refresh token for access token
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    
    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token"
            }
        )
        token_res.raise_for_status()
        access_token = token_res.json()["access_token"]
        
        raw = build_raw_message(to, from_addr, subject, body)
        
        send_res = await client.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"raw": raw}
        )
        send_res.raise_for_status()
        data = send_res.json()
        
    return {
        "messageId": data["id"],
        "threadId": data["threadId"],
        "mock": False,
    }

async def list_recent_inbound(refresh_token: str, max_results: int = 25) -> list[dict]:
    if not google_configured() or refresh_token == "mock":
        return []

    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    
    async with httpx.AsyncClient(timeout=10) as client:
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token"
            }
        )
        if token_res.status_code >= 400:
            return []
            
        access_token = token_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}
        
        list_res = await client.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            headers=headers,
            params={"q": "in:inbox newer_than:2d", "maxResults": max_results}
        )
        if list_res.status_code >= 400:
            return []
            
        messages = list_res.json().get("messages", [])
        ids = [m["id"] for m in messages if m.get("id")]
        
        out = []
        import re
        
        for msg_id in ids:
            try:
                msg_res = await client.get(
                    f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}",
                    headers=headers,
                    params={"format": "metadata", "metadataHeaders": ["From", "Subject", "In-Reply-To", "References"]}
                )
                if msg_res.status_code >= 400: continue
                data = msg_res.json()
                
                payload_headers = data.get("payload", {}).get("headers", [])
                
                def get_header(name: str) -> str:
                    for h in payload_headers:
                        if h.get("name", "").lower() == name.lower():
                            return h.get("value", "")
                    return ""
                    
                from_hdr = get_header("From")
                snippet = data.get("snippet", "")
                
                out.append({
                    "id": msg_id,
                    "threadId": data.get("threadId", ""),
                    "from": from_hdr,
                    "snippet": snippet,
                    "inReplyToThread": data.get("threadId", ""),
                    "isBounce": bool(re.search(r'mailer-daemon|postmaster|delivery status notification', from_hdr, re.I) or 
                                     re.search(r'delivery has failed|undeliverable|address not found', snippet, re.I)),
                    "isAutoReply": bool(re.search(r'out of office|on vacation|i am away|auto-reply|automatic reply|autoreply', snippet, re.I))
                })
            except Exception:
                pass
                
        return out
