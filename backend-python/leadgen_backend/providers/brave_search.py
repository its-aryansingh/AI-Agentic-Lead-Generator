import os
import httpx
import re

def has_brave_key() -> bool:
    return bool(os.getenv("BRAVE_SEARCH_KEY"))

MOCK_PEOPLE = [
    {"name": "Priya Sharma", "title": "Head of Marketing", "company": "Razorpay", "location": "Bangalore"},
    {"name": "Rahul Mehta", "title": "VP Sales", "company": "Freshworks", "location": "Chennai"},
    {"name": "Ananya Iyer", "title": "Director of Growth", "company": "CRED", "location": "Bangalore"},
    {"name": "Vikram Singh", "title": "Chief Marketing Officer", "company": "Zerodha", "location": "Bangalore"},
    {"name": "Tanvir Ahmed", "title": "Head of Demand Gen", "company": "Postman", "location": "Singapore"},
    {"name": "Mira Kapoor", "title": "Growth Lead", "company": "Khatabook", "location": "Mumbai"},
    {"name": "Arjun Reddy", "title": "CRO", "company": "Chargebee", "location": "Chennai"},
    {"name": "Sneha Pillai", "title": "Director, Product Marketing", "company": "Hasura", "location": "Bangalore"},
    {"name": "Karthik Subramanian", "title": "VP of Marketing", "company": "Zoho", "location": "Chennai"},
    {"name": "Divya Nair", "title": "Head of B2B Marketing", "company": "MoEngage", "location": "Bangalore"},
    {"name": "Faisal Khan", "title": "Co-founder & CEO", "company": "Pesto Tech", "location": "Bangalore"},
    {"name": "Ritika Bose", "title": "Marketing Lead, SEA", "company": "Xendit", "location": "Jakarta"},
    {"name": "Aditya Bansal", "title": "Growth Manager", "company": "Setu", "location": "Bangalore"},
    {"name": "Lakshmi Rao", "title": "Senior Director, Marketing", "company": "Whatfix", "location": "San Francisco / Bangalore"},
    {"name": "Nikhil Verma", "title": "Head of Customer Acquisition", "company": "Slice", "location": "Bangalore"},
]

def hash_index(s: str, max_val: int) -> int:
    h = 0
    for char in s:
        h = (h << 5) - h + ord(char)
        h = h & 0xFFFFFFFF
    return abs(h) % max_val

def mock_candidates(query: str, n: int) -> list[dict]:
    start = hash_index(query, len(MOCK_PEOPLE))
    picked = []
    for i in range(min(n, len(MOCK_PEOPLE))):
        p = MOCK_PEOPLE[(start + i) % len(MOCK_PEOPLE)]
        slug = re.sub(r'\s+', '-', p["name"].lower())
        loc_str = f"{p.get('location', '')}. " if p.get("location") else ""
        picked.append({
            "name": p["name"],
            "title": p["title"],
            "company": p["company"],
            "location": p.get("location"),
            "source": "mock",
            "source_url": f"https://www.linkedin.com/in/{slug}",
            "snippet": f"{p['name']} - {p['title']} at {p['company']}. {loc_str}Result from mock data (set BRAVE_SEARCH_KEY for real results).",
        })
    return picked

async def brave_search_raw(query: str, count: int = 20) -> list[dict]:
    if not has_brave_key():
        return []
        
    url = "https://api.search.brave.com/res/v1/web/search"
    headers = {
        "Accept": "application/json",
        "X-Subscription-Token": os.getenv("BRAVE_SEARCH_KEY") or ""
    }
    
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(url, params={"q": query, "count": count, "country": "IN"}, headers=headers)
        res.raise_for_status()
        data = res.json()
        return data.get("web", {}).get("results", [])
    except httpx.HTTPError:
        return []

def parse_linkedin_snippet(r: dict) -> dict | None:
    cleaned = re.sub(r'\s*\|\s*LinkedIn.*$', '', r.get("title", ""), flags=re.I).strip()
    
    # Pattern 1
    m1 = re.match(r'^(.+?)\s+[-–—]\s+(.+?)\s+at\s+(.+?)$', cleaned, re.I)
    if m1:
        return {
            "name": m1.group(1).strip(),
            "title": m1.group(2).strip(),
            "company": m1.group(3).strip(),
            "source": "brave",
            "source_url": r.get("url", ""),
            "snippet": r.get("description", ""),
        }
        
    # Pattern 2
    m2 = re.match(r'^(.+?)\s+[-–—]\s+(.+?),\s+(.+?)$', cleaned, re.I)
    if m2:
        return {
            "name": m2.group(1).strip(),
            "title": m2.group(2).strip(),
            "company": m2.group(3).strip(),
            "source": "brave",
            "source_url": r.get("url", ""),
            "snippet": r.get("description", ""),
        }
        
    # Pattern 3
    if 0 < len(cleaned) < 80:
        return {
            "name": cleaned,
            "title": "(role unclear from snippet)",
            "company": "(company unclear)",
            "source": "brave",
            "source_url": r.get("url", ""),
            "snippet": r.get("description", ""),
        }
        
    return None

async def discover_prospects(opts: dict) -> list[dict]:
    max_res = opts.get("max_results", 15)
    query = opts.get("query", "")
    
    if not has_brave_key():
        return mock_candidates(query, max_res)
        
    bias = " site:linkedin.com/in"
    results = await brave_search_raw(query + bias, min(max_res, 20))
    
    out = []
    for r in results[:max_res]:
        parsed = parse_linkedin_snippet(r)
        if parsed:
            out.append(parsed)
            
    return out
