import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BolnaVoiceProvider,
  buildManagedBolnaAgentPayload,
  buildSalesEngAiApiTools,
  listBolnaAccountVoices,
  listBolnaAgents,
  listBolnaCredentialProviders,
  listBolnaOutboundNumbers,
  provisionBolnaQualificationAgent,
  updateBolnaQualificationAgent,
  verifyBolnaConnection,
  verifyBolnaOutboundNumber,
  verifyBolnaVoiceChoice,
} from "@/lib/voice/providers/bolna";
import type { PlaceCallRequest } from "@/lib/voice/provider";

const provider = new BolnaVoiceProvider({
  apiKey: "test-key",
  agentId: "agent-1",
});

test("Bolna statuses normalize without making call-disconnected terminal", () => {
  assert.deepEqual(provider.onEvent({ id: "1", status: "ringing" }), {
    kind: "ringing",
    callId: "1",
  });
  assert.deepEqual(
    provider.onEvent({
      id: "2",
      status: "call-disconnected",
      updated_at: "2026-09-03T00:00:00Z",
    }),
    {
      kind: "answered",
      callId: "2",
      at: "2026-09-03T00:00:00Z",
    },
  );
  assert.deepEqual(provider.onEvent({ id: "3", status: "no-answer" }), {
    kind: "no_answer",
    callId: "3",
  });
  assert.deepEqual(provider.onEvent({ id: "4", status: "busy" }), {
    kind: "busy",
    callId: "4",
  });
});

test("Bolna completion normalizes transcript, duration, and recording", () => {
  assert.deepEqual(
    provider.onEvent({
      id: "5",
      status: "completed",
      transcript: "Agent: Hello\nCustomer: Call me next week",
      conversation_time: 42,
      telephony_data: { recording_url: "https://example.com/recording.mp3" },
    }),
    {
      kind: "completed",
      callId: "5",
      transcript: [
        { speaker: "agent", text: "Hello" },
        { speaker: "recipient", text: "Call me next week" },
      ],
      durationSeconds: 42,
      recordingRef: "https://example.com/recording.mp3",
    },
  );
  assert.deepEqual(
    provider.onEvent({
      execution_id: "6",
      status: "completed",
      answered_by_voice_mail: true,
    }),
    { kind: "voicemail", callId: "6" },
  );
  assert.deepEqual(
    provider.onEvent({
      id: "6-empty-recording",
      status: "completed",
      telephony_data: { recording_url: "" },
    }),
    {
      kind: "completed",
      callId: "6-empty-recording",
      transcript: [],
      durationSeconds: 0,
      recordingRef: undefined,
    },
  );
});

test("Bolna failures preserve a useful provider reason", () => {
  assert.deepEqual(
    provider.onEvent({
      id: "7",
      status: "failed",
      error_message: "destination rejected",
    }),
    { kind: "failed", callId: "7", reason: "destination rejected" },
  );
  assert.throws(
    () => provider.onEvent({ id: "8", status: "future-status" }),
    /Unsupported Bolna execution status/,
  );
});

test("Bolna dialing carries the compliance receipt and disables retry", async () => {
  const previousFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ execution_id: "execution-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const request: PlaceCallRequest = {
    to: "+919876543210",
    from: "+911140001400",
    agentPrompt: "Disclose AI identity, then qualify the lead.",
    knowledge: [],
    boundedActions: ["ASK_QUESTION", "END_CALL"],
    hardLimits: {
      maxCallSeconds: 180,
      maxTurns: 12,
      maxObjectionAttempts: 2,
    },
    idempotencyKey: "request-1",
    decisionId: "decision-1",
  };

  try {
    assert.deepEqual(await provider.placeCall(request), {
      callId: "execution-1",
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.deepEqual(body?.retry_config, { enabled: false });
  assert.equal(body?.bypass_call_guardrails, false);
  const userData = body?.user_data as Record<string, string>;
  assert.equal(userData.compliance_decision_id, "decision-1");
  assert.equal(userData.idempotency_key, "request-1");
});

test("managed Bolna agent enforces disclosure, limits, and no reschedule", () => {
  const payload = buildManagedBolnaAgentPayload({
    agentName: "Aravya Qualification Agent",
    webhookUrl: "https://sales.example.com/api/webhooks/bolna/connection",
    language: "hinglish",
    maxCallSeconds: 180,
    maxTurns: 12,
    maxObjectionAttempts: 1,
    callStartHour: 9,
    callEndHour: 18,
  });
  const agent = payload.agent_config;
  assert.match(agent.agent_welcome_message, /^Hello .*I am an AI assistant/i);
  assert.deepEqual(agent.calling_guardrails, {
    call_start_hour: 9,
    call_end_hour: 18,
  });
  const task = agent.tasks[0];
  assert.equal(task.task_config.call_terminate, 180);
  assert.equal(task.task_config.auto_reschedule, false);
  assert.equal(task.tools_config.transcriber.language, "multi-hi");
  assert.equal(task.tools_config.llm_agent.llm_config.temperature, 1);
  assert.match(agent.agent_welcome_message, /\{\{customer_name\}\}/);
  assert.match(
    payload.agent_prompts.task_1.system_prompt,
    /one or two sentences/i,
  );
  assert.match(payload.agent_prompts.task_1.system_prompt, /at most 12 turns/i);
});

test("managed Bolna agent rejects unsafe limits", () => {
  assert.throws(
    () =>
      buildManagedBolnaAgentPayload({
        agentName: "Unsafe agent",
        webhookUrl: "https://sales.example.com/webhook",
        language: "en",
        maxCallSeconds: 301,
        maxTurns: 12,
        maxObjectionAttempts: 1,
        callStartHour: 9,
        callEndHour: 18,
      }),
    /<=300/i,
  );
});

test("Bolna v2 agent management parses list and creation responses", async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/v2/agent/all")) {
      return Response.json([
        {
          id: "3c90c3cc-0d44-4b50-8888-8dd25736052a",
          agent_name: "Aravya",
          agent_status: "processed",
        },
      ]);
    }
    if (init?.method === "PUT") {
      return Response.json({
        agent_id: "3c90c3cc-0d44-4b50-8888-8dd25736052a",
        status: "updated",
      });
    }
    return Response.json(
      {
        agent_id: "3c90c3cc-0d44-4b50-8888-8dd25736052a",
        state: "created",
      },
      { status: 201 },
    );
  };

  try {
    const agents = await listBolnaAgents("test-key");
    assert.equal(agents[0].agent_name, "Aravya");
    const created = await provisionBolnaQualificationAgent("test-key", {
      agentName: "Aravya",
      webhookUrl: "https://sales.example.com/webhook",
      language: "en",
      maxCallSeconds: 180,
      maxTurns: 12,
      maxObjectionAttempts: 1,
      callStartHour: 9,
      callEndHour: 18,
    });
    assert.equal(created.state, "created");
    const updated = await updateBolnaQualificationAgent(
      "test-key",
      created.agent_id,
      {
        agentName: "Aravya",
        webhookUrl: "https://sales.example.com/webhook",
        language: "hi",
        maxCallSeconds: 120,
        maxTurns: 10,
        maxObjectionAttempts: 0,
        callStartHour: 10,
        callEndHour: 17,
      },
    );
    assert.equal(updated.status, "updated");
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.deepEqual(requests, [
    { url: "https://api.bolna.ai/v2/agent/all", method: "GET" },
    { url: "https://api.bolna.ai/v2/agent", method: "POST" },
    {
      url: "https://api.bolna.ai/v2/agent/3c90c3cc-0d44-4b50-8888-8dd25736052a",
      method: "PUT",
    },
  ]);
});

test("Bolna connection verification waits for managed-agent processing", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      agent_id: "3c90c3cc-0d44-4b50-8888-8dd25736052a",
      agent_status: "seeding",
    });

  try {
    await assert.rejects(
      verifyBolnaConnection("test-key", "3c90c3cc-0d44-4b50-8888-8dd25736052a"),
      /still processing/i,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Bolna caller ID verification includes account and active SIP trunk numbers", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/phone-numbers/all")) {
      return Response.json([
        {
          phone_number: "+911140001400",
          telephony_provider: "plivo",
          rented: true,
        },
      ]);
    }
    return Response.json([
      {
        is_active: true,
        phone_numbers: [
          {
            phone_number: "919876543210",
            telephony_provider: "sip-trunk",
            deleted: false,
          },
        ],
      },
    ]);
  };

  try {
    const numbers = await listBolnaOutboundNumbers("test-key");
    assert.deepEqual(numbers, [
      {
        phoneNumber: "+911140001400",
        telephonyProvider: "plivo",
        source: "account",
      },
      {
        phoneNumber: "919876543210",
        telephonyProvider: "sip-trunk",
        source: "sip_trunk",
      },
    ]);
    assert.equal(
      (await verifyBolnaOutboundNumber("test-key", "+919876543210")).source,
      "sip_trunk",
    );
    await assert.rejects(
      verifyBolnaOutboundNumber("test-key", "+919999999999"),
      /not found in this Bolna account/i,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Bolna voice and model-provider inventory is account backed", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/me/voices")) {
      return Response.json([
        {
          id: "3c90c3cc-0d44-4b50-8888-8dd25736052a",
          voice_id: "voice-account-1",
          provider: "elevenlabs",
          name: "Nila",
          model: "eleven_turbo_v2_5",
          accent: "India (English) female",
        },
      ]);
    }
    return Response.json([
      {
        provider_id: "3c90c3cc-0d44-4b50-8888-8dd25736052a",
        provider_name: "ANTHROPIC_API_KEY",
        provider_value: "xxxx",
      },
    ]);
  };

  try {
    const voices = await listBolnaAccountVoices("test-key");
    assert.deepEqual(voices[0], {
      voiceId: "voice-account-1",
      name: "Nila",
      provider: "elevenlabs",
      model: "eleven_turbo_v2_5",
      accent: "India (English) female",
    });
    assert.equal(
      (
        await verifyBolnaVoiceChoice("test-key", {
          voiceId: "voice-account-1",
          name: "Nila",
          provider: "elevenlabs",
          model: "eleven_turbo_v2_5",
        })
      ).name,
      "Nila",
    );
    assert.deepEqual(await listBolnaCredentialProviders("test-key"), [
      "ANTHROPIC_API_KEY",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("managed SIP agents include Bolna's agent-level telephony route", () => {
  const payload = buildManagedBolnaAgentPayload({
    agentName: "BYOT Agent",
    webhookUrl: "https://sales.example.com/webhook",
    language: "en",
    maxCallSeconds: 180,
    maxTurns: 12,
    maxObjectionAttempts: 1,
    callStartHour: 9,
    callEndHour: 18,
    telephonyProvider: "sip-trunk",
  });
  assert.equal(payload.agent_config.telephony_provider, "sip-trunk");
  assert.equal(
    payload.agent_config.tasks[0].tools_config.input.provider,
    "sip-trunk",
  );
});

test("managed agents attach confirmed SalesEngAI actions using Bolna ToolModel", () => {
  const url =
    "https://sales.example.com/api/webhooks/bolna/connection/actions?signature=signed";
  const apiTools = buildSalesEngAiApiTools(url, true);
  assert.deepEqual(
    apiTools.tools.map((tool) =>
      String((tool.function as Record<string, unknown>).name),
    ),
    ["schedule_sales_callback", "email_booking_link"],
  );
  assert.equal(apiTools.tools_params.schedule_sales_callback.url, url);
  assert.equal(
    (apiTools.tools_params.schedule_sales_callback.param as Record<string, unknown>)
      .execution_id,
    "{salesengai_execution_id}",
  );

  const payload = buildManagedBolnaAgentPayload({
    agentName: "Action Agent",
    webhookUrl: "https://sales.example.com/webhook",
    actionWebhookUrl: url,
    bookingLinkEnabled: false,
    language: "en",
    maxCallSeconds: 180,
    maxTurns: 12,
    maxObjectionAttempts: 1,
    callStartHour: 9,
    callEndHour: 18,
  });
  const attached = payload.agent_config.tasks[0].tools_config.api_tools;
  assert.equal(attached.tools.length, 1);
  assert.equal(attached.tools_params.email_booking_link, undefined);
});

test("managed agents gate Bolna's reserved transfer tool with a fixed destination", () => {
  const url =
    "https://sales.example.com/api/webhooks/bolna/connection/actions?signature=signed";
  const apiTools = buildSalesEngAiApiTools(url, false, {
    phone: "+919876543210",
    timezone: "Asia/Kolkata",
    startHour: 9,
    endHour: 18,
    weekdays: [1, 2, 3, 4, 5],
    fallback: "schedule_callback",
  });
  assert.deepEqual(
    apiTools.tools.map((tool) =>
      String((tool.function as Record<string, unknown>).name),
    ),
    [
      "schedule_sales_callback",
      "check_human_transfer_availability",
      "transfer_call",
    ],
  );
  assert.equal(
    apiTools.tools_params.check_human_transfer_availability.url,
    url,
  );
  assert.equal(apiTools.tools_params.transfer_call.url, undefined);
  assert.equal(
    (apiTools.tools_params.transfer_call.param as Record<string, unknown>)
      .call_transfer_number,
    "+919876543210",
  );

  const payload = buildManagedBolnaAgentPayload({
    agentName: "Transfer Agent",
    webhookUrl: "https://sales.example.com/webhook",
    actionWebhookUrl: url,
    transferEnabled: true,
    transferPhone: "+919876543210",
    transferTimezone: "Asia/Kolkata",
    transferStartHour: 9,
    transferEndHour: 18,
    transferWeekdays: [1, 2, 3, 4, 5],
    transferFallback: "schedule_callback",
    language: "en",
    maxCallSeconds: 180,
    maxTurns: 12,
    maxObjectionAttempts: 1,
    callStartHour: 9,
    callEndHour: 18,
  });
  assert.match(
    payload.agent_prompts.task_1.system_prompt,
    /check_human_transfer_availability/,
  );
});

test("managed agents offer verified slots before confirmed calendar booking", () => {
  const url =
    "https://sales.example.com/api/webhooks/bolna/connection/actions?signature=signed";
  const tools = buildSalesEngAiApiTools(url, false, undefined, true);
  assert.deepEqual(
    tools.tools.slice(-2).map((tool) =>
      String((tool.function as Record<string, unknown>).name),
    ),
    ["find_meeting_slots", "book_confirmed_meeting"],
  );
  assert.equal(
    (tools.tools_params.find_meeting_slots.param as Record<string, unknown>)
      .confirmed,
    false,
  );
  assert.equal(
    (tools.tools_params.book_confirmed_meeting.param as Record<string, unknown>)
      .confirmation_evidence,
    "%(confirmation_evidence)s",
  );
});

test("managed Bolna agent supports extended options: voice, ambient noise, LLM and telephony", () => {
  const payload = buildManagedBolnaAgentPayload({
    agentName: "Advanced Agent",
    webhookUrl: "https://sales.example.com/webhook",
    language: "en",
    maxCallSeconds: 240,
    maxTurns: 15,
    maxObjectionAttempts: 2,
    callStartHour: 9,
    callEndHour: 18,
    agentWelcomeMessage:
      "Hi {{customer_name}}, calling from {{seller_company}} regarding sales acceleration.",
    voiceId: "aarav-voice-id",
    voiceName: "Aarav",
    llmProvider: "anthropic",
    llmModel: "claude-3-5-sonnet",
    temperature: 0.5,
    ambientNoise: true,
    ambientNoiseTrack: "coffee-shop",
    interruptionWords: 3,
    silenceHangupSeconds: 15,
    telephonyProvider: "exotel",
  });

  const agent = payload.agent_config;
  assert.equal(
    agent.agent_welcome_message,
    "Hi {{customer_name}}, calling from {{seller_company}} regarding sales acceleration.",
  );
  const task = agent.tasks[0];
  assert.equal(task.tools_config.synthesizer.provider_config.voice, "Aarav");
  assert.equal(
    task.tools_config.synthesizer.provider_config.voice_id,
    "aarav-voice-id",
  );
  assert.equal(task.tools_config.llm_agent.llm_config.provider, "anthropic");
  assert.equal(
    task.tools_config.llm_agent.llm_config.model,
    "claude-3-5-sonnet",
  );
  assert.equal(task.tools_config.llm_agent.llm_config.temperature, 0.5);
  assert.equal(task.tools_config.input.provider, "exotel");
  assert.equal(task.tools_config.output.provider, "exotel");
  assert.equal(task.task_config.ambient_noise, true);
  assert.equal(task.task_config.ambient_noise_track, "coffee-shop");
  assert.equal(task.task_config.number_of_words_for_interruption, 3);
  assert.equal(task.task_config.hangup_after_silence, 15);
});
