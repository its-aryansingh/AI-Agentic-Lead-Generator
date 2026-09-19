import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptCredential,
  encryptCredential,
} from "@/lib/credential-crypto";
const secret = "test-secret-that-is-long-enough-for-hkdf";
test("credential encryption round trips without exposing plaintext", () => {
  const encrypted = encryptCredential("refresh-token-value", secret);
  assert.equal(encrypted.includes("refresh-token-value"), false);
  assert.equal(decryptCredential(encrypted, secret), "refresh-token-value");
});
test("credential decryption rejects wrong keys and tampering", () => {
  const encrypted = encryptCredential("token", secret);
  assert.throws(() =>
    decryptCredential(encrypted, "another-secret-that-is-long-enough"),
  );
  assert.throws(() => decryptCredential(encrypted + "x", secret));
});
test("credential decryption falls back to secondary env keys when primary differs", () => {
  const oldKey = "old-mailbox-secret-that-is-long-enough";
  const newKey = "new-connection-key-that-is-long-enough";
  const prevConn = process.env.CONNECTION_ENCRYPTION_KEY;
  const prevMailbox = process.env.MAILBOX_STATE_SECRET;
  try {
    process.env.CONNECTION_ENCRYPTION_KEY = newKey;
    process.env.MAILBOX_STATE_SECRET = oldKey;
    const encryptedWithOld = encryptCredential("old-token", oldKey);
    const encryptedWithNew = encryptCredential("new-token", newKey);
    assert.equal(decryptCredential(encryptedWithOld), "old-token");
    assert.equal(decryptCredential(encryptedWithNew), "new-token");
  } finally {
    process.env.CONNECTION_ENCRYPTION_KEY = prevConn;
    process.env.MAILBOX_STATE_SECRET = prevMailbox;
  }
});
