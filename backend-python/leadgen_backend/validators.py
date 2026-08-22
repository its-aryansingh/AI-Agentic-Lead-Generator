"""
Pure validation functions ported from Next.js TypeScript code.
No I/O or network calls.
"""
from __future__ import annotations

import json
import os
import re

EXPO_TOKEN_RE = re.compile(r"^Expo(nent)?PushToken\[[^\]]+\]$")
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)
DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$", re.IGNORECASE
)

VALID_STAGES = frozenset(
    {"contacted", "replied", "interested", "converted", "unsubscribed"}
)


def is_valid_expo_token(token: str) -> bool:
    if not isinstance(token, str):
        return False
    return bool(EXPO_TOKEN_RE.match(token))


def is_valid_push_token(token: str, provider: str) -> bool:
    if not isinstance(token, str):
        return False
    if provider == "expo":
        return is_valid_expo_token(token)
    elif provider == "web":
        # Expo-format strings are not valid web push subscription tokens
        if is_valid_expo_token(token):
            return False
        return 8 <= len(token) <= 2048
    return False


def is_valid_web_push_subscription(sub: dict) -> bool:
    if not isinstance(sub, dict):
        return False
    endpoint = sub.get("endpoint")
    if not isinstance(endpoint, str) or not endpoint.startswith("https://") or len(endpoint) > 2048:
        return False
    
    keys = sub.get("keys")
    if not isinstance(keys, dict):
        return False
    
    p256dh = keys.get("p256dh")
    if not isinstance(p256dh, str) or not (1 <= len(p256dh) <= 256):
        return False
        
    auth = keys.get("auth")
    if not isinstance(auth, str) or not (1 <= len(auth) <= 64):
        return False
        
    return True


def is_vapid_configured() -> bool:
    from leadgen_backend.config import env_value
    pub = env_value("VAPID_PUBLIC_KEY")
    priv = env_value("VAPID_PRIVATE_KEY")
    sub = env_value("VAPID_SUBJECT")
    return bool(pub and priv and sub)


def is_valid_uuid(s: str) -> bool:
    if not isinstance(s, str):
        return False
    return bool(UUID_RE.match(s))


def is_valid_domain(s: str) -> bool:
    if not isinstance(s, str):
        return False
    trimmed = s.strip().lower()
    if not trimmed or len(trimmed) > 253:
        return False
    return bool(DOMAIN_RE.match(trimmed))


def parse_json_body(raw_body: bytes) -> tuple[dict | None, str | None]:
    try:
        parsed = json.loads(raw_body)
        if not isinstance(parsed, dict):
            return None, "invalid JSON"
        return parsed, None
    except (json.JSONDecodeError, TypeError, UnicodeDecodeError):
        return None, "invalid JSON"
