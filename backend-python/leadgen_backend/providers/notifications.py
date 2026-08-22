from datetime import datetime, UTC

async def notify_push(user_id: str, notification: dict, supabase) -> dict:
    return {"sent": False, "skipped": "mocked for now"}

async def notify_slack(user_id: str, message: dict, supabase) -> dict:
    return {"sent": False, "skipped": "mocked for now"}
