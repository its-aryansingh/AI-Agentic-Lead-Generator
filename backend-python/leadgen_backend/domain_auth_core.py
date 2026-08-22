"""
Pure SPF / DKIM / DMARC parsers ported from lib/domain-auth-core.ts.
No I/O or DNS lookups in this module.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class SpfAnalysis:
    found: bool
    record: str | None
    policy: str  # 'pass', 'soft_fail', 'hard_fail', 'neutral', 'none'
    lookup_count_estimate: int
    issues: tuple[str, ...]


@dataclass(frozen=True)
class DmarcAnalysis:
    found: bool
    record: str | None
    policy: str | None  # 'none', 'quarantine', 'reject', or None
    subdomain_policy: str | None
    pct: int | None
    has_rua: bool
    has_ruf: bool
    issues: tuple[str, ...]


@dataclass(frozen=True)
class DkimSelectorHit:
    selector: str
    record: str


@dataclass(frozen=True)
class DkimAnalysis:
    found: bool
    selectors_checked: tuple[str, ...]
    hits: tuple[DkimSelectorHit, ...]
    issues: tuple[str, ...]


@dataclass(frozen=True)
class OverallSummary:
    grade: str  # 'good', 'fair', 'poor'
    recommendations: tuple[str, ...]


_DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$",
    re.IGNORECASE,
)


def is_valid_domain(s: str) -> bool:
    """Return True if *s* looks like a valid fully-qualified domain name."""
    if not isinstance(s, str):
        return False
    trimmed = s.strip().lower()
    if not trimmed or len(trimmed) > 253:
        return False
    return bool(_DOMAIN_RE.match(trimmed))


COMMON_DKIM_SELECTORS: tuple[str, ...] = (
    "google", "selector1", "selector2", "default", "mail",
    "k1", "k2", "mxvault", "smtpapi", "scph0922",
    "s1", "s2", "pm", "amazonses", "zoho", "mandrill", "mailgun",
)


def parse_spf_record(record: str) -> SpfAnalysis | None:
    if not isinstance(record, str):
        return None
    r = record.strip()
    if not re.match(r"^v=spf1\b", r, re.IGNORECASE):
        return None

    mechanisms = re.split(r"\s+", r)[1:]
    issues: list[str] = []
    policy = "none"

    for m in mechanisms:
        if re.match(r"^([+~?-]?)all$", m, re.IGNORECASE):
            prefix = m[0]
            if prefix == "-":
                policy = "hard_fail"
            elif prefix == "~":
                policy = "soft_fail"
            elif prefix == "?":
                policy = "neutral"
            else:
                policy = "pass"

    if policy == "none":
        issues.append("SPF record has no `all` mechanism — receivers have no instruction for unauthorized senders")
    elif policy == "pass":
        issues.append("SPF policy is `+all` — accepts mail from anywhere; effectively no protection")
    elif policy == "neutral":
        issues.append("SPF policy is `?all` (neutral) — explicitly does not assert pass/fail")

    lookup_count = 0
    for m in mechanisms:
        if re.match(r"^(include:|a(:|$)|mx(:|$)|ptr(:|$)|exists:|redirect=)", m, re.IGNORECASE):
            lookup_count += 1
            
    if lookup_count > 10:
        issues.append(f"SPF record has {lookup_count} lookups (> RFC 7208 limit of 10) — may PermError")

    return SpfAnalysis(
        found=True,
        record=r,
        policy=policy,
        lookup_count_estimate=lookup_count,
        issues=tuple(issues),
    )


def _normalize_dmarc_policy(s: str | None) -> str | None:
    if not s:
        return None
    lower = s.strip().lower()
    if lower in ("none", "quarantine", "reject"):
        return lower
    return None


def parse_dmarc_record(record: str) -> DmarcAnalysis | None:
    if not isinstance(record, str):
        return None
    r = record.strip()
    if not re.match(r"^v=DMARC1\b", r, re.IGNORECASE):
        return None

    tags: dict[str, str] = {}
    for match in re.finditer(r"([a-z]+)=([^;]+)", r, re.IGNORECASE):
        tags[match.group(1).lower()] = match.group(2).strip()

    policy = _normalize_dmarc_policy(tags.get("p"))
    sub_policy = _normalize_dmarc_policy(tags.get("sp")) or policy
    
    pct: int | None = None
    if "pct" in tags:
        try:
            n = int(tags["pct"])
            if 0 <= n <= 100:
                pct = n
        except ValueError:
            pass

    has_rua = "rua" in tags
    has_ruf = "ruf" in tags
    
    issues: list[str] = []
    if not policy:
        issues.append("DMARC record has no `p=` tag — receivers default to `none` (monitor-only)")
    elif policy == "none":
        issues.append("DMARC policy is `none` — failures are reported but not blocked; tighten to `quarantine` after monitoring")
        
    if not has_rua:
        issues.append("No `rua=` reporting address — you're flying blind on auth failures")
        
    if pct is not None and pct < 100:
        issues.append(f"DMARC pct={pct} — only {pct}% of mail is enforced; ramp to 100 once stable")

    return DmarcAnalysis(
        found=True,
        record=r,
        policy=policy,
        subdomain_policy=sub_policy,
        pct=pct,
        has_rua=has_rua,
        has_ruf=has_ruf,
        issues=tuple(issues),
    )


def summarize_dkim(checked: Sequence[str], hits: Sequence[DkimSelectorHit]) -> DkimAnalysis:
    issues: list[str] = []
    if not hits:
        issues.append("No DKIM record found at common selectors — emails will fail DKIM and lose deliverability. Set up DKIM in your sending provider.")
        
    for h in hits:
        if not re.match(r"^v=DKIM1\b", h.record, re.IGNORECASE):
            issues.append(f"DKIM record at {h.selector} doesn't start with v=DKIM1 (may be misformatted)")
        if re.search(r"p=\s*(;|$)", h.record, re.IGNORECASE):
            issues.append(f"DKIM selector {h.selector} has an empty public key (key revoked)")
            
    return DkimAnalysis(
        found=len(hits) > 0,
        selectors_checked=tuple(checked),
        hits=tuple(hits),
        issues=tuple(issues),
    )


def summarize_overall(spf: SpfAnalysis, dkim: DkimAnalysis, dmarc: DmarcAnalysis) -> OverallSummary:
    recs: list[str] = []
    score = 0
    
    # SPF: 0-2 points
    if spf.found:
        if spf.policy == "hard_fail":
            score += 2
        elif spf.policy == "soft_fail":
            score += 1
        else:
            recs.append("Tighten SPF to `-all` (hard fail) once your sending IPs are stable")
    else:
        recs.append("Add an SPF record — it tells receivers which servers may send for your domain")
        
    # DKIM: 0-2 points
    if dkim.found:
        score += 2
    else:
        recs.append("Enable DKIM in your sending provider — without it your mail fails alignment")
        
    # DMARC: 0-2 points
    if dmarc.found:
        if dmarc.policy in ("reject", "quarantine"):
            score += 2
        else:
            score += 1
            recs.append("Move DMARC from p=none to p=quarantine after a week of monitoring")
            
        if not dmarc.has_rua:
            recs.append("Add a DMARC `rua=` reporting address (e.g. mailto:dmarc@yourdomain.com)")
    else:
        recs.append("Add a DMARC record — it ties SPF + DKIM together and tells receivers what to do on failure")
        
    grade: str
    if score >= 5:
        grade = "good"
    elif score >= 3:
        grade = "fair"
    else:
        grade = "poor"
        
    return OverallSummary(
        grade=grade,
        recommendations=tuple(recs),
    )
