"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { VOICE_LLM_MODELS } from "@/lib/voice/agent-policy-core";

export type LanguageChoice = "en" | "hi" | "hinglish";

export interface VoiceSpeaker {
  id: string;
  name: string;
  voiceId: string;
  description: string;
  provider?: string;
  model?: string;
}

interface AccountVoice {
  voiceId: string;
  name: string;
  provider: string;
  model: string;
  accent: string | null;
}

export const VOICE_PRESETS: Record<LanguageChoice, VoiceSpeaker[]> = {
  en: [
    {
      id: "nila",
      name: "Nila",
      voiceId: "V9LCAAi4tTlqe9JadbCo",
      description: "Indian English (Professional Female - Recommended)",
    },
    {
      id: "aarav",
      name: "Aarav",
      voiceId: "g5CIjZEefAph4nQFvHAz",
      description: "Indian English (Confident Male)",
    },
    {
      id: "rachel",
      name: "Rachel",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
      description: "US Neutral (Friendly Female)",
    },
    {
      id: "brian",
      name: "Brian",
      voiceId: "nPczCjzI2devNBz1zQrb",
      description: "US Deep (Executive Male)",
    },
    {
      id: "george",
      name: "George",
      voiceId: "JBFqnCBsd6RMkjVDRZzb",
      description: "British (Warm Formal Male)",
    },
    {
      id: "custom",
      name: "Custom",
      voiceId: "",
      description: "Custom Voice ID (ElevenLabs / Cartesia)",
    },
  ],
  hi: [
    {
      id: "nila_hi",
      name: "Nila",
      voiceId: "V9LCAAi4tTlqe9JadbCo",
      description: "Hindi (Professional Female - Native Accent)",
    },
    {
      id: "aarav_hi",
      name: "Aarav",
      voiceId: "g5CIjZEefAph4nQFvHAz",
      description: "Hindi (Natural Conversational Male)",
    },
    {
      id: "priya_hi",
      name: "Priya",
      voiceId: "z9fAnlkpzviPz146aGWa",
      description: "Hindi (Clear Expressive Female)",
    },
    {
      id: "kabir_hi",
      name: "Kabir",
      voiceId: "N2lVS1w4EtoT3dr4eOWO",
      description: "Hindi (Deep Authoritative Male)",
    },
    {
      id: "custom",
      name: "Custom",
      voiceId: "",
      description: "Custom Voice ID (ElevenLabs / Cartesia)",
    },
  ],
  hinglish: [
    {
      id: "nila_hinglish",
      name: "Nila",
      voiceId: "V9LCAAi4tTlqe9JadbCo",
      description: "Hinglish (Code-Switching Professional Female)",
    },
    {
      id: "aarav_hinglish",
      name: "Aarav",
      voiceId: "g5CIjZEefAph4nQFvHAz",
      description: "Hinglish (Conversational Urban Male)",
    },
    {
      id: "priya_hinglish",
      name: "Priya",
      voiceId: "z9fAnlkpzviPz146aGWa",
      description: "Hinglish (Energetic Code-Switching Female)",
    },
    {
      id: "custom",
      name: "Custom",
      voiceId: "",
      description: "Custom Voice ID (ElevenLabs / Cartesia)",
    },
  ],
};

interface VoicePolicyFormProps {
  connection: Record<string, unknown> | null;
  saveAction: (formData: FormData) => Promise<void>;
  isManaged: boolean;
  isConnected: boolean;
  availableVoices: AccountVoice[];
  configuredProviders: string[];
}

export function VoicePolicyForm({
  connection,
  saveAction,
  isManaged,
  isConnected,
  availableVoices,
  configuredProviders,
}: VoicePolicyFormProps) {
  const options =
    (connection?.agent_options as Record<string, unknown> | null) ?? {};
  const initialLang = String(
    connection?.default_language ?? "en",
  ) as LanguageChoice;
  const [selectedLanguage, setSelectedLanguage] =
    React.useState<LanguageChoice>(
      ["en", "hi", "hinglish"].includes(initialLang) ? initialLang : "en",
    );

  const initialVoiceName = String(options.voiceName ?? "Nila");
  const initialVoiceId = String(options.voiceId ?? "V9LCAAi4tTlqe9JadbCo");
  const initialVoiceProvider = String(
    options.synthesizerProvider ?? "elevenlabs",
  );
  const initialVoiceModel = String(
    options.synthesizerModel ?? "eleven_turbo_v2_5",
  );

  // Determine initial selected speaker preset based on saved voice name/id
  const currentPresetList: VoiceSpeaker[] =
    availableVoices.length > 0
      ? availableVoices.map((voice) => ({
          id: `${voice.provider}:${voice.model}:${voice.voiceId}`,
          name: voice.name,
          voiceId: voice.voiceId,
          provider: voice.provider,
          model: voice.model,
          description: [voice.provider, voice.model, voice.accent]
            .filter(Boolean)
            .join(" · "),
        }))
      : VOICE_PRESETS[selectedLanguage] || VOICE_PRESETS.en;
  const matchedPreset = currentPresetList.find(
    (p) =>
      p.name.toLowerCase() === initialVoiceName.toLowerCase() ||
      (p.voiceId && p.voiceId === initialVoiceId),
  );
  const initialPreset =
    matchedPreset ??
    (availableVoices.length > 0 ? currentPresetList[0] : undefined);

  const [selectedPresetId, setSelectedPresetId] = React.useState<string>(
    initialPreset?.id ?? "custom",
  );
  const [voiceId, setVoiceId] = React.useState<string>(
    initialPreset?.voiceId ?? initialVoiceId,
  );
  const [voiceName, setVoiceName] = React.useState<string>(
    initialPreset?.name ?? initialVoiceName,
  );
  const [voiceProvider, setVoiceProvider] =
    React.useState<string>(initialPreset?.provider ?? initialVoiceProvider);
  const [voiceModel, setVoiceModel] = React.useState<string>(
    initialPreset?.model ?? initialVoiceModel,
  );
  const initialLlmModel = String(options.llmModel ?? "gpt-5.4-mini");
  const [llmModel, setLlmModel] = React.useState(initialLlmModel);
  const [temperature, setTemperature] = React.useState(
    Number(options.temperature ?? 1),
  );
  const [ambientNoise, setAmbientNoise] = React.useState<boolean>(
    Boolean(options.ambientNoise),
  );
  const [isPending, startTransition] = React.useTransition();

  // When language changes, update speaker preset list automatically
  function handleLanguageChange(newLang: LanguageChoice) {
    setSelectedLanguage(newLang);
    if (availableVoices.length > 0) return;
    const presets = VOICE_PRESETS[newLang] || VOICE_PRESETS.en;
    // Default to the first preset for the new language
    const defaultPreset = presets[0];
    setSelectedPresetId(defaultPreset.id);
    setVoiceName(defaultPreset.name);
    setVoiceId(defaultPreset.voiceId);
    setVoiceProvider(defaultPreset.provider ?? "elevenlabs");
    setVoiceModel(defaultPreset.model ?? "eleven_turbo_v2_5");
  }

  // When speaker preset changes, update voice ID and name
  function handlePresetChange(presetId: string) {
    setSelectedPresetId(presetId);
    const preset = currentPresetList.find((p) => p.id === presetId);
    if (preset && preset.id !== "custom") {
      setVoiceName(preset.name);
      setVoiceId(preset.voiceId);
      setVoiceProvider(preset.provider ?? "elevenlabs");
      setVoiceModel(preset.model ?? "eleven_turbo_v2_5");
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      await saveAction(formData);
    });
  }

  const hasExistingAgent = Boolean(
    connection?.agent_id && connection?.status !== "disconnected",
  );
  const buttonLabel = isPending
    ? isManaged
      ? hasExistingAgent
        ? "Saving & Synchronizing..."
        : "Creating Managed Agent..."
      : "Saving Call Policy..."
    : isManaged
      ? hasExistingAgent
        ? "Save & Synchronize Agent"
        : "Create & Provision Managed Agent"
      : "Save Call Policy";
  const selectedLlm =
    VOICE_LLM_MODELS.find((model) => model.id === llmModel) ??
    VOICE_LLM_MODELS[0];
  const hasProvider = (provider: string) =>
    provider === "openai" ||
    configuredProviders.includes(`${provider.toUpperCase()}_API_KEY`);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        {/* SECTION 1: Voice Persona & Speech */}
        <Card className="border border-border/70 bg-card/60 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span className="text-base">🎙️</span> Voice Persona & Language
              Adaptation
            </CardTitle>
            <CardDescription className="text-xs">
              Configure speaker accents and dynamic code-switching for Indian
              and global sales calls.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <div className="grid gap-3.5 md:grid-cols-2">
              {/* Language Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Primary Language
                </label>
                <select
                  name="language"
                  value={selectedLanguage}
                  onChange={(e) =>
                    handleLanguageChange(e.target.value as LanguageChoice)
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                >
                  <option value="en">English (Indian / Global)</option>
                  <option value="hi">Hindi (Formal & Natural Accent)</option>
                  <option value="hinglish">
                    Hinglish (Bilingual Code-Switching)
                  </option>
                </select>
                {availableVoices.length === 0 && isConnected && (
                  <p className="text-[11px] text-amber-600">
                    Bolna voice inventory could not be loaded. Saving will
                    re-verify this voice against your account.
                  </p>
                )}
              </div>

              {/* Dynamic Voice Preset based on selected Language */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Voice & Accent Preset ({selectedLanguage.toUpperCase()})
                </label>
                <select
                  name="voice_preset"
                  value={selectedPresetId}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                >
                  {currentPresetList.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name} — {preset.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Custom Voice Fields */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Selected Voice Name
                </label>
                <Input
                  name="custom_voice_name"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  placeholder="e.g. Nila"
                  className="h-9 text-xs"
                  readOnly={availableVoices.length > 0}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  ElevenLabs Voice ID
                </label>
                <Input
                  name="custom_voice_id"
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  placeholder="Voice ID (e.g. V9LCAAi4tTlqe9JadbCo)"
                  className="h-9 text-xs font-mono"
                  readOnly={availableVoices.length > 0}
                />
                <input
                  type="hidden"
                  name="synthesizer_provider"
                  value={voiceProvider}
                />
                <input
                  type="hidden"
                  name="synthesizer_model"
                  value={voiceModel}
                />
              </div>

              {/* Ambient Sound Dynamics */}
              <div className="md:col-span-2 pt-1 border-t border-border/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="ambient_noise"
                    checked={ambientNoise}
                    onChange={(e) => setAmbientNoise(e.target.checked)}
                    className="size-4 rounded border-input text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Simulate realistic ambient phone background sound</span>
                </label>

                {ambientNoise && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Ambient sound track:
                    </span>
                    <select
                      name="ambient_noise_track"
                      defaultValue={String(
                        options.ambientNoiseTrack ?? "office",
                      )}
                      className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
                    >
                      <option value="office">Subtle Office Chatter</option>
                      <option value="coffee-shop">Coffee Shop Ambience</option>
                      <option value="call-center">
                        Call Center Background
                      </option>
                    </select>
                  </div>
                )}
              </div>

              {/* Custom Greeting */}
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center justify-between">
                  <span>Custom Greeting Opening</span>
                  <span className="text-[11px] text-muted-foreground font-normal">
                    Leave blank to use default mandatory disclosure
                  </span>
                </label>
                <Input
                  name="agent_welcome_message"
                  defaultValue={String(options.agentWelcomeMessage ?? "")}
                  placeholder="Hello {{customer_name}}, I am calling from {{seller_company}}..."
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SECTION 2: Safeguards & Calling Window */}
        <Card className="border border-border/70 bg-card/60 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span className="text-base">⏰</span> Compliance & Calling Window
              Safeguards
            </CardTitle>
            <CardDescription className="text-xs">
              Enforce strict anti-harassment calling hours, duration limits, and
              human escalation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3.5 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Calling Timezone
                </label>
                <Input
                  name="timezone"
                  defaultValue={String(
                    connection?.calling_timezone ?? "Asia/Kolkata",
                  )}
                  placeholder="Asia/Kolkata"
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Human Transfer Phone (Optional)
                </label>
                <Input
                  name="human_transfer_phone"
                  defaultValue={String(connection?.human_transfer_phone ?? "")}
                  placeholder="+919876543210 (E.164)"
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-2 md:col-span-2 rounded-lg border border-border/60 p-3">
                <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="transfer_enabled"
                    defaultChecked={connection?.transfer_enabled === true}
                    className="size-4 rounded border-input text-indigo-600 focus:ring-indigo-500"
                  />
                  Enable availability-gated live human transfer
                </label>
                <p className="text-[11px] text-muted-foreground">
                  The AI checks the schedule below after an explicit transfer
                  request. The destination remains server-controlled and is
                  never chosen or spoken by the model.
                </p>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">
                      Team timezone
                    </label>
                    <Input
                      name="transfer_timezone"
                      defaultValue={String(
                        connection?.transfer_timezone ??
                          connection?.calling_timezone ??
                          "Asia/Kolkata",
                      )}
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">
                      Available from
                    </label>
                    <Input
                      name="transfer_start_hour"
                      type="number"
                      min="0"
                      max="23"
                      defaultValue={Number(connection?.transfer_start_hour ?? 9)}
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">
                      Available until
                    </label>
                    <Input
                      name="transfer_end_hour"
                      type="number"
                      min="1"
                      max="24"
                      defaultValue={Number(connection?.transfer_end_hour ?? 18)}
                      className="h-9 text-xs"
                    />
                  </div>
                </div>
                <fieldset className="space-y-1.5">
                  <legend className="text-xs text-muted-foreground">
                    Available days
                  </legend>
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {[
                      [1, "Mon"],
                      [2, "Tue"],
                      [3, "Wed"],
                      [4, "Thu"],
                      [5, "Fri"],
                      [6, "Sat"],
                      [7, "Sun"],
                    ].map(([value, label]) => {
                      const saved = Array.isArray(connection?.transfer_weekdays)
                        ? connection.transfer_weekdays.map(Number)
                        : [1, 2, 3, 4, 5];
                      return (
                        <label
                          key={value}
                          className="flex items-center gap-1.5 text-xs cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            name="transfer_weekdays"
                            value={value}
                            defaultChecked={saved.includes(Number(value))}
                            className="size-3.5 rounded border-input"
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    If nobody is available
                  </label>
                  <select
                    name="transfer_fallback"
                    defaultValue={String(
                      connection?.transfer_fallback ?? "schedule_callback",
                    )}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
                  >
                    <option value="schedule_callback">Offer a callback</option>
                    <option value="human_review">Create a human-review request</option>
                    <option value="end_call">Apologize and end the call</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-foreground">
                  Approved Booking Link (Optional)
                </label>
                <Input
                  name="booking_link_url"
                  type="url"
                  defaultValue={String(connection?.booking_link_url ?? "")}
                  placeholder="https://cal.com/your-team/intro"
                  className="h-9 text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  The agent may email only this pre-approved link after the
                  recipient explicitly confirms.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Start Hour (0–23)
                </label>
                <Input
                  name="start_hour"
                  type="number"
                  min="0"
                  max="23"
                  defaultValue={Number(connection?.call_start_hour ?? 9)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  End Hour (1–24)
                </label>
                <Input
                  name="end_hour"
                  type="number"
                  min="1"
                  max="24"
                  defaultValue={Number(connection?.call_end_hour ?? 18)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Max Call Duration (30–300 seconds)
                </label>
                <Input
                  name="max_call_seconds"
                  type="number"
                  min="30"
                  max="300"
                  defaultValue={Number(connection?.max_call_seconds ?? 180)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Max Conversation Turns (2–30)
                </label>
                <Input
                  name="max_turns"
                  type="number"
                  min="2"
                  max="30"
                  defaultValue={Number(connection?.max_turns ?? 12)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-foreground">
                  Max Objection Retry Attempts (0–2)
                </label>
                <Input
                  name="max_objection_attempts"
                  type="number"
                  min="0"
                  max="2"
                  defaultValue={Number(connection?.max_objection_attempts ?? 1)}
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SECTION 3: Advanced AI & Telephony (Collapsible Accordion) */}
        <details className="group rounded-xl border border-border/70 p-4 bg-card/40 transition-all shadow-xs">
          <summary className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between cursor-pointer select-none">
            <span className="flex items-center gap-1.5">
              <span>⚡</span> Advanced AI Intelligence & Telephony
            </span>
            <span className="text-[10px] text-primary/80 group-open:rotate-180 transition-transform">
              ▼
            </span>
          </summary>
          <div className="grid gap-3.5 md:grid-cols-2 pt-3.5 mt-2 border-t border-border/50">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                LLM Model (Speed vs Depth)
              </label>
              <select
                name="llm_model"
                value={llmModel}
                onChange={(event) => setLlmModel(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
              >
                {VOICE_LLM_MODELS.map((model) => (
                  <option
                    key={model.id}
                    value={model.id}
                    disabled={!hasProvider(model.provider)}
                  >
                    {model.label}
                    {!hasProvider(model.provider)
                      ? " — configure provider in Bolna"
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                LLM Temperature (0.0 strict – 1.0 natural)
              </label>
              <Input
                name="temperature"
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={selectedLlm.temperatureLocked ? 1 : temperature}
                onChange={(event) => setTemperature(Number(event.target.value))}
                readOnly={selectedLlm.temperatureLocked}
                className="h-9 text-xs"
              />
              {selectedLlm.temperatureLocked && (
                <p className="text-[11px] text-muted-foreground">
                  This model requires temperature 1.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Interruption Sensitivity (Barge-in Threshold)
              </label>
              <select
                name="interruption_words"
                defaultValue={Number(options.interruptionWords ?? 2)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="1">1 word (Highest sensitivity)</option>
                <option value="2">2 words (Balanced - Recommended)</option>
                <option value="3">3 words (Patient / Low sensitivity)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Silence Timeout Before Hangup (seconds)
              </label>
              <Input
                name="silence_hangup_seconds"
                type="number"
                min="5"
                max="30"
                defaultValue={Number(options.silenceHangupSeconds ?? 10)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-medium text-foreground">
                Telephony Carrier Route
              </label>
              <select
                name="telephony_provider"
                defaultValue={String(options.telephonyProvider ?? "plivo")}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="plivo">
                  Plivo (Default Global & India routes)
                </option>
                <option value="exotel">
                  Exotel (India 140/1600 Commercial DLT)
                </option>
                <option value="twilio">Twilio</option>
                <option value="sip-trunk">
                  Customer SIP trunk (verified caller ID required)
                </option>
              </select>
            </div>
          </div>
        </details>
      </div>

      {/* SUBMIT BUTTON */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          {isManaged
            ? "Settings synchronize directly to your Bolna agent with signed callbacks."
            : "External agent: ensure safeguards match your manual Bolna setup."}
        </p>
        <Button
          type="submit"
          disabled={isPending || (!isConnected && !isManaged)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm font-medium transition-all active:scale-[0.98]"
        >
          {buttonLabel}
        </Button>
      </div>
    </form>
  );
}
