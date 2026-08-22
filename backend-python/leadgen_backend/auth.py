import re
from dataclasses import dataclass


JWT_RE = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
BEARER_RE = re.compile(r"^Bearer\s+(.+)$", re.IGNORECASE)


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str | None = None


@dataclass(frozen=True)
class AuthResult:
    user: AuthUser | None
    reason: str | None = None


def parse_bearer_token(header_value: str | None) -> str | None:
    if not header_value:
        return None
    match = BEARER_RE.match(header_value.strip())
    if not match:
        return None
    token = match.group(1).strip()
    if not token or re.search(r"\s", token):
        return None
    return token


def looks_like_jwt(token: str) -> bool:
    return bool(JWT_RE.match(token))

