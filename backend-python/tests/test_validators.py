import unittest

from leadgen_backend.validators import (
    is_valid_expo_token,
    is_valid_push_token,
    is_valid_web_push_subscription,
    is_valid_uuid,
    is_valid_domain,
)


class TestValidators(unittest.TestCase):
    def test_expo_token_valid(self):
        self.assertTrue(is_valid_expo_token("ExpoPushToken[123abc]"))
        self.assertTrue(is_valid_expo_token("ExponentPushToken[xyz]"))

    def test_expo_token_invalid(self):
        self.assertFalse(is_valid_expo_token("ExpoPushToken[123abc"))
        self.assertFalse(is_valid_expo_token("ExponentPushToken"))
        self.assertFalse(is_valid_expo_token(None))
        
    def test_push_token_routing(self):
        self.assertTrue(is_valid_push_token("ExpoPushToken[123]", "expo"))
        self.assertFalse(is_valid_push_token("ExpoPushToken[123]", "web"))
        
        self.assertTrue(is_valid_push_token("a" * 10, "web"))
        self.assertFalse(is_valid_push_token("a" * 10, "expo"))
        self.assertFalse(is_valid_push_token("a" * 2500, "web"))
        self.assertFalse(is_valid_push_token("short", "web"))
        
        self.assertFalse(is_valid_push_token("ExpoPushToken[123]", "unknown"))
        
    def test_web_push_subscription(self):
        valid = {
            "endpoint": "https://fcm.googleapis.com/fcm/send/foo",
            "keys": {
                "p256dh": "p256dh_key",
                "auth": "auth_key",
            }
        }
        self.assertTrue(is_valid_web_push_subscription(valid))
        
        invalid_endpoint = dict(valid, endpoint="http://insecure.com")
        self.assertFalse(is_valid_web_push_subscription(invalid_endpoint))
        
        invalid_keys = dict(valid, keys={"p256dh": "key"}) # missing auth
        self.assertFalse(is_valid_web_push_subscription(invalid_keys))
        
    def test_uuid(self):
        self.assertTrue(is_valid_uuid("123e4567-e89b-12d3-a456-426614174000"))
        self.assertFalse(is_valid_uuid("123e4567-e89b-12d3-a456-42661417400"))
        self.assertFalse(is_valid_uuid("not-a-uuid"))
        
    def test_domain(self):
        self.assertTrue(is_valid_domain("example.com"))
        self.assertTrue(is_valid_domain("sub.example.com"))
        self.assertFalse(is_valid_domain("invalid_domain.com"))
        self.assertFalse(is_valid_domain("http://example.com"))
