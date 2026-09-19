import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import {
  greetingHasMandatoryDisclosure,
  isVoiceTelephonyProvider,
  resolveVoiceLlm,
} from "@/lib/voice/agent-policy-core";

test("custom greetings require AI and seller disclosure", () => {
  assert.equal(
    greetingHasMandatoryDisclosure(
      "Hello, I am an AI assistant calling for {{seller_company}}.",
    ),
    true,
  );
  assert.equal(greetingHasMandatoryDisclosure("Hello from our sales team."), false);

  const source = fs.readFileSync("lib/voice/agent-policy.ts", "utf8");
  assert.match(source, /!greetingHasMandatoryDisclosure/);
});

test("GPT-5 voice models always use temperature one", () => {
  assert.deepEqual(resolveVoiceLlm("gpt-5.4-mini", 0.2), {
    model: "gpt-5.4-mini",
    provider: "openai",
    temperature: 1,
  });
});

test("SIP trunk is an explicit supported telephony route", () => {
  assert.equal(isVoiceTelephonyProvider("sip-trunk"), true);
  assert.equal(isVoiceTelephonyProvider("arbitrary-carrier"), false);
});
