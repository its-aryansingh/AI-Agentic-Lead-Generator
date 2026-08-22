import os
import httpx
import re

PH_GRAPHQL = "https://api.producthunt.com/v2/api/graphql"

MOCK_MAKERS = [
    {"name": "Arnav Gupta", "title": "Founder", "company": "StackPilot", "location": "Bangalore"},
    {"name": "Meera Joshi", "title": "Co-founder", "company": "FlowDesk", "location": "Mumbai"},
    {"name": "Chris Tan", "title": "Maker", "company": "ShipFast AI", "location": "Singapore"},
    {"name": "Ishaan Patel", "title": "CEO", "company": "LedgerLoop", "location": "Ahmedabad"},
    {"name": "Nina Cho", "title": "Founder", "company": "PromptForge", "location": "Seoul"},
    {"name": "Leo Martins", "title": "Indie hacker", "company": "TinyCRM", "location": "Lisbon"},
    {"name": "Sara Kim", "title": "Product lead", "company": "NotionForms+", "location": "Remote"},
    {"name": "Dev Malhotra", "title": "Maker", "company": "ColdStart Kit", "location": "Delhi"},
]

def hash_index(s: str, max_val: int) -> int:
    h = 0
    for char in s:
        h = (h << 5) - h + ord(char)
        h = h & 0xFFFFFFFF
    return abs(h) % max_val

def has_ph_token() -> bool:
    return bool(os.getenv("PRODUCTHUNT_TOKEN"))

def mock_ph_candidates(query: str, max_results: int) -> list[dict]:
    start = hash_index(query, len(MOCK_MAKERS))
    out = []
    for i in range(min(max_results, len(MOCK_MAKERS))):
        p = MOCK_MAKERS[(start + i) % len(MOCK_MAKERS)]
        slug = re.sub(r'\s+', '', p["name"].lower())
        out.append({
            "name": p["name"],
            "title": p["title"],
            "company": p["company"],
            "location": p.get("location"),
            "source": "mock",
            "source_url": f"https://www.producthunt.com/@{slug}",
            "snippet": f"{p['name']} launched {p['company']} — {p['title']}. Mock Product Hunt data (set PRODUCTHUNT_TOKEN for live results)."
        })
    return out

async def search_producthunt_makers(query: str, max_results: int) -> list[dict]:
    if not has_ph_token():
        return mock_ph_candidates(query, max_results)
        
    gql = """
    query RecentPosts($first: Int!) {
      posts(first: $first, order: RANKING) {
        edges {
          node {
            name
            tagline
            url
            makers {
              name
              username
              headline
            }
          }
        }
      }
    }
    """
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {os.getenv('PRODUCTHUNT_TOKEN')}",
        "Accept": "application/json"
    }
    
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            res = await client.post(
                PH_GRAPHQL,
                headers=headers,
                json={"query": gql, "variables": {"first": min(max_results * 6, 50)}}
            )
            if res.status_code >= 400: return mock_ph_candidates(query, max_results)
            json_data = res.json()
    except httpx.HTTPError:
        return mock_ph_candidates(query, max_results)
        
    if json_data.get("errors"):
        return mock_ph_candidates(query, max_results)
        
    edges = json_data.get("data", {}).get("posts", {}).get("edges", [])
    terms = [t for t in query.lower().split() if len(t) > 2]
    
    by_username = {}
    
    for edge in edges:
        post = edge.get("node")
        if not post: continue
        haystack = f"{post.get('name', '')} {post.get('tagline', '')}".lower()
        
        if terms and not any(t in haystack for t in terms):
            continue
            
        for maker in post.get("makers", []):
            username = maker.get("username")
            if not username or username in by_username: continue
            
            name = maker.get("name") or username
            
            snip_parts = [post.get("tagline"), f"Launched {post.get('name', '')}"]
            snippet = " — ".join([str(p) for p in snip_parts if p])
            
            by_username[username] = {
                "name": name,
                "title": maker.get("headline") or "Product Hunt maker",
                "company": post.get("name", ""),
                "source": "producthunt",
                "source_url": f"https://www.producthunt.com/@{username}",
                "snippet": snippet
            }
            if len(by_username) >= max_results: break
        if len(by_username) >= max_results: break
        
    results = list(by_username.values())
    return results if results else mock_ph_candidates(query, max_results)
