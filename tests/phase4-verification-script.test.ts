import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync("scripts/verify-phase4-voice.ps1", "utf8");

test("Phase 4 verification script is safe by default and covers worker and local database checks", () => {
  assert.match(script, /\[switch\]\$CheckOnly/);
  assert.match(script, /docker build -t salesengai-python-worker/);
  assert.match(script, /python -m unittest discover -s tests -v/);
  assert.match(script, /npx\.cmd supabase db lint/);
  assert.match(script, /\[switch\]\$StartLocalSupabase/);
});

test("real Bolna smoke is explicit, consent-targeted, and never the default", () => {
  assert.match(script, /\[switch\]\$RunProviderSmoke/);
  assert.match(script, /\[switch\]\$ConfirmProviderSmoke/);
  assert.match(script, /ProviderLeadId must be a UUID/);
  assert.match(script, /run-phase4-bolna-smoke\.mjs/);
  assert.match(script, /Provider smoke is intentionally blocked/);
});
