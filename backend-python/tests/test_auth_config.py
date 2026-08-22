import unittest

from leadgen_backend.auth import looks_like_jwt, parse_bearer_token
from leadgen_backend.config import pick_latest_migration, provider_matrix, Settings
from leadgen_backend.route_inventory import NEXT_API_ROUTES, PYTHON_ROUTES


class AuthTests(unittest.TestCase):
    def test_parse_bearer_token_accepts_case_insensitive_scheme(self) -> None:
        self.assertEqual(parse_bearer_token("bearer abc.def.ghi"), "abc.def.ghi")

    def test_parse_bearer_token_rejects_internal_whitespace(self) -> None:
        self.assertIsNone(parse_bearer_token("Bearer abc def"))

    def test_looks_like_jwt_requires_three_segments(self) -> None:
        self.assertTrue(looks_like_jwt("abc.def.ghi"))
        self.assertFalse(looks_like_jwt("abc.def"))


class ConfigTests(unittest.TestCase):
    def test_pick_latest_migration_uses_numeric_prefix(self) -> None:
        self.assertEqual(
            pick_latest_migration(["0001_init.sql", "0016_push.sql", "0010_crm.sql"]),
            "0016_push.sql",
        )

    def test_provider_matrix_requires_composite_keys(self) -> None:
        settings = Settings(
            anthropic_api_key="x",
            brave_search_key=None,
            google_client_id="id",
            google_client_secret=None,
            supabase_url="url",
            supabase_anon_key="anon",
            supabase_service_role_key=None,
            github_token=None,
            producthunt_token=None,
            inngest_event_key="event",
            inngest_signing_key="sign",
            scraper_url=None,
            scraper_key=None,
            whatsapp_api_url=None,
            whatsapp_api_key=None,
            whatsapp_from=None,
            hubspot_api_key=None,
            razorpay_key_id=None,
            razorpay_key_secret=None,
            stripe_secret_key=None,
        )
        matrix = provider_matrix(settings)
        self.assertTrue(matrix["anthropic"])
        self.assertFalse(matrix["google"])
        self.assertTrue(matrix["supabase"])
        self.assertTrue(matrix["inngest"])


class RouteInventoryTests(unittest.TestCase):
    def test_django_inventory_covers_current_next_api_surface(self) -> None:
        paths = {route["path"] for route in NEXT_API_ROUTES}
        self.assertIn("/api/chat", paths)
        self.assertIn("/api/webhooks/stripe", paths)
        self.assertEqual(len(paths), 26)

    def test_python_routes_are_marked_django(self) -> None:
        frameworks = {route["framework"] for route in PYTHON_ROUTES}
        self.assertEqual(frameworks, {"django"})


if __name__ == "__main__":
    unittest.main()
