"""
Smoke tests for the Python backend agent module.
Run with: python -m pytest tests/test_agent_smoke.py -v
  or via Node test runner: npm test (if test runner is configured)
"""
import os
import sys
import asyncio
import unittest

# Set up Django environment before importing
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "leadgen_backend.settings")


class TestToolDefinitions(unittest.TestCase):
    def test_all_tools_have_required_fields(self):
        from leadgen_backend.agent.tool_definitions import ALL_TOOLS
        for tool in ALL_TOOLS:
            self.assertIn("name", tool, f"Tool missing 'name': {tool}")
            self.assertIn("description", tool, f"Tool missing 'description': {tool}")
            self.assertIn("input_schema", tool, f"Tool missing 'input_schema': {tool}")
            self.assertIsInstance(tool["input_schema"], dict)

    def test_all_nine_tools_registered(self):
        from leadgen_backend.agent.tool_definitions import ALL_TOOLS
        names = {t["name"] for t in ALL_TOOLS}
        expected = {
            "web_search", "public_source_search", "enrich_prospect",
            "clarify_question", "add_named_prospects", "start_bulk_job",
            "launch_campaign", "push_to_crm", "draft_reply",
        }
        self.assertEqual(names, expected)


class TestSystemPrompt(unittest.TestCase):
    def test_system_prompt_is_non_empty(self):
        from leadgen_backend.agent.system_prompt import SYSTEM_PROMPT
        self.assertIsInstance(SYSTEM_PROMPT, str)
        self.assertGreater(len(SYSTEM_PROMPT), 500)

    def test_system_prompt_contains_tool_names(self):
        from leadgen_backend.agent.system_prompt import SYSTEM_PROMPT
        for tool in ["web_search", "enrich_prospect", "start_bulk_job", "launch_campaign"]:
            self.assertIn(tool, SYSTEM_PROMPT, f"'{tool}' not mentioned in system prompt")


class TestToolHandlerDispatch(unittest.TestCase):
    def test_unknown_tool_returns_error(self):
        from leadgen_backend.agent.tool_handlers import dispatch_tool
        from leadgen_backend.config import get_settings
        from leadgen_backend.supabase_rest import SupabaseRest

        async def run():
            settings = get_settings()
            supabase = SupabaseRest(settings)
            ctx = {"user_id": "test-uid", "session_id": "test-sid"}
            result = await dispatch_tool("nonexistent_tool", {}, ctx, settings, supabase)
            return result

        result = asyncio.run(run())
        self.assertIn("error", result)
        self.assertIn("Unknown tool", result["error"])

    def test_clarify_tool_returns_question(self):
        from leadgen_backend.agent.tool_handlers import dispatch_tool
        from leadgen_backend.config import get_settings
        from leadgen_backend.supabase_rest import SupabaseRest

        async def run():
            settings = get_settings()
            supabase = SupabaseRest(settings)
            ctx = {"user_id": "test-uid", "session_id": "test-sid"}
            result = await dispatch_tool(
                "clarify_question",
                {"question": "What industry?", "suggested_answers": ["fintech", "saas"]},
                ctx,
                settings,
                supabase,
            )
            return result

        result = asyncio.run(run())
        self.assertEqual(result["question"], "What industry?")
        self.assertEqual(result["suggested_answers"], ["fintech", "saas"])


class TestProviders(unittest.TestCase):
    def test_anthropic_mock_draft(self):
        from leadgen_backend.providers.anthropic_client import mock_draft
        draft = mock_draft({"name": "Priya Sharma", "company": "Razorpay", "title": "VP Marketing"})
        self.assertIn("email_subject", draft)
        self.assertIn("email_body", draft)
        self.assertIn("research_summary", draft)
        self.assertIsInstance(draft["talking_points"], list)

    def test_anthropic_no_key_returns_mock(self):
        # Ensure API key is not set for this test
        old_key = os.environ.pop("ANTHROPIC_API_KEY", None)
        try:
            from leadgen_backend.providers.anthropic_client import has_anthropic_key
            self.assertFalse(has_anthropic_key())
        finally:
            if old_key:
                os.environ["ANTHROPIC_API_KEY"] = old_key


class TestConfig(unittest.TestCase):
    def test_settings_has_all_new_fields(self):
        from leadgen_backend.config import get_settings
        settings = get_settings()
        # New fields added for Phase 11
        self.assertTrue(hasattr(settings, "vapid_public_key"))
        self.assertTrue(hasattr(settings, "zoho_client_id"))
        self.assertTrue(hasattr(settings, "slack_webhook_url"))
        self.assertTrue(hasattr(settings, "cron_secret"))


if __name__ == "__main__":
    unittest.main()
