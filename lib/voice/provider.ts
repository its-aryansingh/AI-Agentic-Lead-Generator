import type {
  HardLimits,
  KnowledgeRef,
  NormalizedCallEvent,
  VoiceAction,
} from "@/lib/voice/types";

export interface PlaceCallRequest {
  to: string;
  from: string;
  agentPrompt: string;
  knowledge: KnowledgeRef[];
  boundedActions: VoiceAction["kind"][];
  hardLimits: HardLimits;
  idempotencyKey: string;
  decisionId: string;
}

export interface VoiceProvider {
  placeCall(request: PlaceCallRequest): Promise<{ callId: string }>;
  onEvent(raw: unknown): NormalizedCallEvent;
}
