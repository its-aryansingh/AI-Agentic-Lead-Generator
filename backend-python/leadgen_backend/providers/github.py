import os
import httpx
import asyncio

SEARCH_URL = "https://api.github.com/search/users"
USER_URL = "https://api.github.com/users"

def auth_headers() -> dict:
    base = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "leadgenai/0.5"
    }
    token = os.getenv("GITHUB_TOKEN")
    if token:
        base["Authorization"] = f"Bearer {token}"
    return base

async def search_github_users(query: str, max_results: int) -> list[dict]:
    params = {"q": query, "per_page": min(max_results, 30)}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(SEARCH_URL, headers=auth_headers(), params=params)
            if res.status_code >= 400: return []
            data = res.json()
    except httpx.HTTPError:
        return []
        
    hits = data.get("items", [])[:max_results]
    
    # fetch profiles concurrently
    async def fetch_profile(client, login: str):
        try:
            r = await client.get(f"{USER_URL}/{login}", headers=auth_headers())
            if r.status_code < 400:
                return r.json()
        except httpx.HTTPError:
            pass
        return None

    async with httpx.AsyncClient(timeout=8) as client:
        tasks = [fetch_profile(client, hit["login"]) for hit in hits]
        # In TS we used a bounded concurrency map, asyncio.gather is fine for max 30 profiles.
        profiles = await asyncio.gather(*tasks)
        
    out = []
    for p in profiles:
        if not p: continue
        name = p.get("name") or p.get("login", "")
        title = p.get("bio") or "GitHub user"
        comp = p.get("company", "") or ""
        comp = comp.lstrip("@") or "(independent)"
        loc = p.get("location")
        
        snip_parts = [p.get("bio"), loc, comp]
        snippet = " · ".join([str(x) for x in snip_parts if x]) or f"GitHub profile @{p.get('login', '')}"
        
        out.append({
            "name": name,
            "title": title,
            "company": comp,
            "location": loc,
            "source": "github",
            "source_url": p.get("html_url", ""),
            "snippet": snippet,
        })
        
    return out
