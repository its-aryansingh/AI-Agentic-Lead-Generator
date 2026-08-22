from datetime import datetime, UTC
import math

def daily_cap_for_mailbox(warmup_started_at: datetime) -> int:
    """
    The warm-up curve.
    Uses linear interpolation between checkpoints and ramps to 300/day.
    """
    days = (datetime.now(UTC) - warmup_started_at.replace(tzinfo=UTC)).days
    if days < 0:
        return 10
        
    checkpoints = [
        (0, 10),
        (7, 20),
        (14, 35),
        (21, 50),
        (30, 100),
        (45, 150),
        (60, 250),
        (75, 300),
    ]
    
    for i in range(len(checkpoints) - 1):
        d1, cap1 = checkpoints[i]
        d2, cap2 = checkpoints[i + 1]
        
        if d1 <= days < d2:
            fraction = (days - d1) / (d2 - d1)
            return cap1 + math.floor((cap2 - cap1) * fraction)
            
    return checkpoints[-1][1]
