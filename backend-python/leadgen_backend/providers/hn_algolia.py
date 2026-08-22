import urllib.parse
import httpx
import re

HN_SEARCH = "https://hn.algolia.com/api/v1/search"

def strip_html(s: str) -> str:
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r'&[#\w]+;', ' ', s)
    return s.strip()

def truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n-1] + "…"

async def search_hn_users(query: str, max_results: int) -> list[dict]:
    params = {
        "query": query,
        "hitsPerPage": min(max_results * 3, 100),
        "tags": "story,comment"
    }
    
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(HN_SEARCH, params=params)
            if res.status_code >= 400: return []
            data = res.json()
    except httpx.HTTPError:
        return []
        
    hits = data.get("hits", [])
    
    by_author = {}
    for h in hits:
        author = h.get("author")
        if not author: continue
        if author not in by_author:
            by_author[author] = h
            
    out = []
    for h in list(by_author.values())[:max_results]:
        author = h["author"]
        snippet_raw = h.get("story_title") or h.get("title") or strip_html(h.get("comment_text") or "") or f"HN activity for {author}"
        
        out.append({
            "name": author,
            "title": "Active on Hacker News",
            "company": "(independent)",
            "source": "hn",
            "source_url": f"https://news.ycombinator.com/user?id={urllib.parse.quote(author)}",
            "snippet": truncate(snippet_raw, 240)
        })
        
    return out
