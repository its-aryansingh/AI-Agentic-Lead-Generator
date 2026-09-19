import type { QualificationKey } from "@/lib/qualification";

export type QualificationField = QualificationKey;

export const VOICE_ACTION_KINDS = [
  "ASK_QUESTION",
  "ANSWER",
  "SCHEDULE_CALLBACK",
  "BOOK_MEETING",
  "TRANSFER_HUMAN",
  "SEND_INFORMATION",
  "END_CALL",
] as const;

export type VoiceActionKind = (typeof VOICE_ACTION_KINDS)[number];

export type VoiceAction =
  | { kind: "ASK_QUESTION"; text: string; field?: QualificationField }
  | { kind: "ANSWER"; text: string; citations: string[] }
  | { kind: "SCHEDULE_CALLBACK"; at: string; tz: string }
  | { kind: "BOOK_MEETING"; slotId: string }
  | { kind: "TRANSFER_HUMAN"; reason: string }
  | { kind: "SEND_INFORMATION"; docId: string }
  | { kind: "END_CALL"; reason: string };

export interface HardLimits {
  maxCallSeconds: number;
  maxTurns: number;
  maxObjectionAttempts: number;
}

export interface KnowledgeRef {
  id: string;
  title: string;
  excerpt: string;
  citation: string;
}

export interface TranscriptSegment {
  speaker: "agent" | "recipient";
  text: string;
  startedAtSeconds?: number;
  endedAtSeconds?: number;
}

export type NormalizedCallEvent =
  | { kind: "ringing"; callId: string }
  | { kind: "answered"; callId: string; at: string }
  | { kind: "no_answer"; callId: string }
  | { kind: "busy"; callId: string }
  | { kind: "voicemail"; callId: string }
  | {
      kind: "completed";
      callId: string;
      transcript: TranscriptSegment[];
      durationSeconds: number;
      recordingRef?: string;
    }
  | { kind: "failed"; callId: string; reason: string };
