from typing import Any

def pick_rotation_mailbox(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    best = None
    best_score = float('inf')
    
    for c in candidates:
        effective_cap = c.get("effective_cap", 0)
        daily_sent = c.get("daily_sent", 0)
        warmup_started = c.get("warmup_started_at_ms", 0)
        
        if effective_cap <= 0:
            continue
        if daily_sent >= effective_cap:
            continue
            
        score = daily_sent / effective_cap
        if score < best_score or (score == best_score and best and warmup_started < best.get("warmup_started_at_ms", 0)):
            best = c
            best_score = score
            
    return best

def total_headroom(candidates: list[dict[str, Any]]) -> int:
    return sum(max(0, c.get("effective_cap", 0) - c.get("daily_sent", 0)) for c in candidates)
