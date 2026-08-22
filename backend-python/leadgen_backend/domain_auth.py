"""
Async DNS layer for SPF / DKIM / DMARC checks.
Ported from lib/domain-auth.ts.
"""
from __future__ import annotations

import asyncio
from dataclasses import asdict
from typing import Any

import dns.asyncresolver
import dns.resolver

from leadgen_backend.domain_auth_core import (
    COMMON_DKIM_SELECTORS,
    DkimAnalysis,
    DkimSelectorHit,
    DmarcAnalysis,
    SpfAnalysis,
    is_valid_domain,
    parse_dmarc_record,
    parse_spf_record,
    summarize_dkim,
    summarize_overall,
)

LOOKUP_TIMEOUT = 3.0


async def check_domain(raw_domain: str) -> dict[str, Any]:
    domain = raw_domain.strip().lower()
    if not is_valid_domain(domain):
        return _not_found_report(domain, "invalid domain")

    degraded = False

    try:
        spf = await _lookup_spf(domain)
    except Exception:
        degraded = True
        spf = _empty_spf()

    try:
        dmarc = await _lookup_dmarc(domain)
    except Exception:
        degraded = True
        dmarc = _empty_dmarc()

    try:
        dkim = await _lookup_dkim(domain)
    except Exception:
        degraded = True
        dkim = _empty_dkim()

    overall = summarize_overall(spf, dkim, dmarc)

    return {
        "domain": domain,
        "spf": asdict(spf),
        "dkim": asdict(dkim),
        "dmarc": asdict(dmarc),
        "overall": asdict(overall),
        "degraded": degraded,
    }


async def _lookup_spf(domain: str) -> SpfAnalysis:
    records = await _resolve_txt_with_timeout(domain)
    for r in records:
        parsed = parse_spf_record(r)
        if parsed:
            return parsed
    return _empty_spf()


async def _lookup_dmarc(domain: str) -> DmarcAnalysis:
    records = await _resolve_txt_with_timeout(f"_dmarc.{domain}")
    for r in records:
        parsed = parse_dmarc_record(r)
        if parsed:
            return parsed
    return _empty_dmarc()


async def _lookup_dkim(domain: str) -> DkimAnalysis:
    checked = list(COMMON_DKIM_SELECTORS)
    hits: list[DkimSelectorHit] = []

    async def _check_selector(selector: str) -> DkimSelectorHit | None:
        try:
            records = await _resolve_txt_with_timeout(f"{selector}._domainkey.{domain}")
            # Pick first record that looks like DKIM
            for r in records:
                if r.lower().startswith("v=dkim1") or "p=" in r:
                    return DkimSelectorHit(selector=selector, record=r)
            return None
        except Exception:
            return None

    results = await asyncio.gather(*[_check_selector(s) for s in checked])
    for r in results:
        if r:
            hits.append(r)

    return summarize_dkim(checked, hits)


async def _resolve_txt_with_timeout(host: str) -> list[str]:
    try:
        resolver = dns.asyncresolver.Resolver()
        resolver.lifetime = LOOKUP_TIMEOUT
        resolver.timeout = LOOKUP_TIMEOUT
        
        # This can raise NXDOMAIN, NoAnswer, Timeout, etc.
        answers = await resolver.resolve(host, "TXT")
        
        # Each answer is a list of byte strings, join them per RFC
        return [b"".join(rdata.strings).decode("utf-8") for rdata in answers]
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.resolver.NoNameservers):
        return []
    except Exception as e:
        raise e


def _empty_spf() -> SpfAnalysis:
    return SpfAnalysis(
        found=False,
        record=None,
        policy="none",
        lookup_count_estimate=0,
        issues=("No SPF record found — receivers can't tell who's authorized to send for this domain",),
    )


def _empty_dmarc() -> DmarcAnalysis:
    return DmarcAnalysis(
        found=False,
        record=None,
        policy=None,
        subdomain_policy=None,
        pct=None,
        has_rua=False,
        has_ruf=False,
        issues=("No DMARC record found — set _dmarc.<domain> with v=DMARC1; p=none; rua=mailto:...",),
    )


def _empty_dkim() -> DkimAnalysis:
    return DkimAnalysis(
        found=False,
        selectors_checked=tuple(COMMON_DKIM_SELECTORS),
        hits=(),
        issues=("No DKIM record found at common selectors — your sending provider must publish one",),
    )


def _not_found_report(domain: str, reason: str) -> dict[str, Any]:
    spf = _empty_spf()
    dmarc = _empty_dmarc()
    dkim = _empty_dkim()
    
    return {
        "domain": domain,
        "spf": asdict(SpfAnalysis(**{**asdict(spf), "issues": (reason,)})),
        "dkim": asdict(DkimAnalysis(**{**asdict(dkim), "issues": (reason,)})),
        "dmarc": asdict(DmarcAnalysis(**{**asdict(dmarc), "issues": (reason,)})),
        "overall": {"grade": "poor", "recommendations": [reason]},
        "degraded": True,
    }
