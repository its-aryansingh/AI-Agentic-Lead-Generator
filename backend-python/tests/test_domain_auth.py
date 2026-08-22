import unittest

from leadgen_backend.domain_auth_core import (
    parse_spf_record,
    parse_dmarc_record,
    summarize_dkim,
    summarize_overall,
    DkimSelectorHit,
)


class TestDomainAuthCore(unittest.TestCase):
    def test_spf_parser(self):
        # Valid pass
        spf = parse_spf_record("v=spf1 include:_spf.google.com ~all")
        self.assertTrue(spf.found)
        self.assertEqual(spf.policy, "soft_fail")
        self.assertEqual(spf.lookup_count_estimate, 1)
        
        # Valid hard fail
        spf = parse_spf_record("v=spf1 a mx -all")
        self.assertEqual(spf.policy, "hard_fail")
        self.assertEqual(spf.lookup_count_estimate, 2)
        
        # Missing v=spf1
        self.assertIsNone(parse_spf_record("v=spf2 ~all"))
        
        # Too many lookups
        long_spf = "v=spf1 include:1 include:2 include:3 include:4 include:5 include:6 include:7 include:8 include:9 include:10 include:11 -all"
        spf = parse_spf_record(long_spf)
        self.assertEqual(spf.lookup_count_estimate, 11)
        self.assertTrue(any("PermError" in issue for issue in spf.issues))

    def test_dmarc_parser(self):
        # Valid quarantine
        dmarc = parse_dmarc_record("v=DMARC1; p=quarantine; rua=mailto:test@test.com")
        self.assertTrue(dmarc.found)
        self.assertEqual(dmarc.policy, "quarantine")
        self.assertEqual(dmarc.subdomain_policy, "quarantine")
        self.assertTrue(dmarc.has_rua)
        
        # Missing rua
        dmarc = parse_dmarc_record("v=DMARC1; p=reject")
        self.assertEqual(dmarc.policy, "reject")
        self.assertFalse(dmarc.has_rua)
        self.assertTrue(any("flying blind" in issue for issue in dmarc.issues))
        
        # pct testing
        dmarc = parse_dmarc_record("v=DMARC1; p=reject; pct=50")
        self.assertEqual(dmarc.pct, 50)
        self.assertTrue(any("pct=50" in issue for issue in dmarc.issues))

    def test_dkim_summarizer(self):
        # No hits
        dkim = summarize_dkim(["google", "s1"], [])
        self.assertFalse(dkim.found)
        self.assertEqual(len(dkim.issues), 1)
        
        # Hit with valid record
        hit = DkimSelectorHit(selector="google", record="v=DKIM1; k=rsa; p=key")
        dkim = summarize_dkim(["google"], [hit])
        self.assertTrue(dkim.found)
        self.assertEqual(len(dkim.issues), 0)
        
        # Hit with revoked record
        hit = DkimSelectorHit(selector="google", record="v=DKIM1; p=;")
        dkim = summarize_dkim(["google"], [hit])
        self.assertTrue(dkim.found)
        self.assertTrue(any("revoked" in issue for issue in dkim.issues))

    def test_overall_scorer(self):
        spf = parse_spf_record("v=spf1 include:_spf.google.com -all")
        dmarc = parse_dmarc_record("v=DMARC1; p=reject; rua=mailto:a@b.com")
        dkim = summarize_dkim(["google"], [DkimSelectorHit(selector="google", record="v=DKIM1; k=rsa; p=key")])
        
        overall = summarize_overall(spf, dkim, dmarc)
        self.assertEqual(overall.grade, "good")
        self.assertEqual(len(overall.recommendations), 0)
        
        # Fair grade (missing dmarc reject)
        dmarc_none = parse_dmarc_record("v=DMARC1; p=none; rua=mailto:a@b.com")
        overall = summarize_overall(spf, dkim, dmarc_none)
        self.assertEqual(overall.grade, "good") # Wait, 2+2+1 = 5, still good.
        
        # Poor grade (missing spf and dmarc)
        spf_none = parse_spf_record("v=spf1 ?all")
        overall = summarize_overall(spf_none, dkim, dmarc_none)
        self.assertEqual(overall.grade, "fair") # 0+2+1 = 3, fair.
