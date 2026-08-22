import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic
from typing import Any


STARTED_AT = monotonic()
REPO_ROOT = Path(__file__).resolve().parents[2]

try:
    from dotenv import load_dotenv

    load_dotenv(REPO_ROOT / "backend-python" / ".env")
except ImportError:
    pass


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str | None
    brave_search_key: str | None
    google_client_id: str | None
    google_client_secret: str | None
    supabase_url: str | None
    supabase_anon_key: str | None
    supabase_service_role_key: str | None
    github_token: str | None
    producthunt_token: str | None
    inngest_event_key: str | None
    inngest_signing_key: str | None
    scraper_url: str | None
    scraper_key: str | None
    whatsapp_api_url: str | None
    whatsapp_api_key: str | None
    whatsapp_from: str | None
    hubspot_api_key: str | None
    razorpay_key_id: str | None
    razorpay_key_secret: str | None
    stripe_secret_key: str | None
    stripe_webhook_secret: str | None = field(default=None)
    razorpay_webhook_secret: str | None = field(default=None)
    whatsapp_webhook_secret: str | None = field(default=None)
    whatsapp_verify_token: str | None = field(default=None)
    # VAPID web push
    vapid_public_key: str | None = field(default=None)
    vapid_private_key: str | None = field(default=None)
    vapid_subject: str | None = field(default=None)
    # Zoho CRM
    zoho_client_id: str | None = field(default=None)
    zoho_client_secret: str | None = field(default=None)
    zoho_refresh_token: str | None = field(default=None)
    zoho_region: str | None = field(default=None)
    # Expo push
    expo_push_access_token: str | None = field(default=None)
    # Slack
    slack_webhook_url: str | None = field(default=None)
    # Cron
    cron_secret: str | None = field(default=None)


def env_value(name: str) -> str | None:
    value = os.getenv(name)
    return value if value else None


def get_settings() -> Settings:
    return Settings(
        anthropic_api_key=env_value("ANTHROPIC_API_KEY"),
        brave_search_key=env_value("BRAVE_SEARCH_KEY"),
        google_client_id=env_value("GOOGLE_CLIENT_ID"),
        google_client_secret=env_value("GOOGLE_CLIENT_SECRET"),
        supabase_url=env_value("NEXT_PUBLIC_SUPABASE_URL"),
        supabase_anon_key=env_value("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        supabase_service_role_key=env_value("SUPABASE_SERVICE_ROLE_KEY"),
        github_token=env_value("GITHUB_TOKEN"),
        producthunt_token=env_value("PRODUCTHUNT_TOKEN"),
        inngest_event_key=env_value("INNGEST_EVENT_KEY"),
        inngest_signing_key=env_value("INNGEST_SIGNING_KEY"),
        scraper_url=env_value("SCRAPER_URL"),
        scraper_key=env_value("SCRAPER_KEY"),
        whatsapp_api_url=env_value("WHATSAPP_API_URL"),
        whatsapp_api_key=env_value("WHATSAPP_API_KEY"),
        whatsapp_from=env_value("WHATSAPP_FROM"),
        hubspot_api_key=env_value("HUBSPOT_API_KEY"),
        razorpay_key_id=env_value("RAZORPAY_KEY_ID"),
        razorpay_key_secret=env_value("RAZORPAY_KEY_SECRET"),
        stripe_secret_key=env_value("STRIPE_SECRET_KEY"),
        stripe_webhook_secret=env_value("STRIPE_WEBHOOK_SECRET"),
        razorpay_webhook_secret=env_value("RAZORPAY_WEBHOOK_SECRET"),
        whatsapp_webhook_secret=env_value("WHATSAPP_WEBHOOK_SECRET"),
        whatsapp_verify_token=env_value("WHATSAPP_VERIFY_TOKEN"),
        vapid_public_key=env_value("VAPID_PUBLIC_KEY"),
        vapid_private_key=env_value("VAPID_PRIVATE_KEY"),
        vapid_subject=env_value("VAPID_SUBJECT"),
        zoho_client_id=env_value("ZOHO_CLIENT_ID"),
        zoho_client_secret=env_value("ZOHO_CLIENT_SECRET"),
        zoho_refresh_token=env_value("ZOHO_REFRESH_TOKEN"),
        zoho_region=env_value("ZOHO_REGION"),
        expo_push_access_token=env_value("EXPO_PUSH_ACCESS_TOKEN"),
        slack_webhook_url=env_value("SLACK_WEBHOOK_URL"),
        cron_secret=env_value("CRON_SECRET"),
    )


def provider_matrix(settings: Settings) -> dict[str, bool]:
    return {
        "anthropic": bool(settings.anthropic_api_key),
        "brave": bool(settings.brave_search_key),
        "google": bool(settings.google_client_id and settings.google_client_secret),
        "supabase": bool(settings.supabase_url and settings.supabase_anon_key),
        "supabase_admin": bool(settings.supabase_service_role_key),
        "github": bool(settings.github_token),
        "producthunt": bool(settings.producthunt_token),
        "inngest": bool(settings.inngest_event_key and settings.inngest_signing_key),
        "scraper": bool(settings.scraper_url and settings.scraper_key),
        "whatsapp": bool(
            settings.whatsapp_api_url
            and settings.whatsapp_api_key
            and settings.whatsapp_from
        ),
        "hubspot": bool(settings.hubspot_api_key),
        "razorpay": bool(settings.razorpay_key_id and settings.razorpay_key_secret),
        "stripe": bool(settings.stripe_secret_key),
    }


def pick_latest_migration(filenames: list[str]) -> str | None:
    sql = [name for name in filenames if name.endswith(".sql")]
    if not sql:
        return None

    def sort_key(name: str) -> tuple[int, str]:
        prefix = name.split("_", 1)[0]
        return (int(prefix) if prefix.isdigit() else -1, name)

    return sorted(sql, key=sort_key, reverse=True)[0]


def read_schema_version() -> str | None:
    migration_dir = REPO_ROOT / "supabase" / "migrations"
    try:
        return pick_latest_migration([path.name for path in migration_dir.iterdir()])
    except OSError:
        return None


def read_crons() -> list[dict[str, str]]:
    vercel_json = REPO_ROOT / "vercel.json"
    try:
        parsed: Any = json.loads(vercel_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    crons = parsed.get("crons") if isinstance(parsed, dict) else None
    if not isinstance(crons, list):
        return []

    out: list[dict[str, str]] = []
    for cron in crons:
        if not isinstance(cron, dict):
            continue
        path = cron.get("path")
        schedule = cron.get("schedule")
        if isinstance(path, str) and isinstance(schedule, str):
            out.append({"path": path, "schedule": schedule})
    return out
