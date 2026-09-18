export interface HandoffFact {
  fact_key: string;
  fact_value: string;
  source_type: string;
  source_excerpt?: string | null;
  confidence: number;
}
export interface HandoffInput {
  name: string;
  company?: string | null;
  title?: string | null;
  bucket: string;
  leadStatus: string;
  nextAction: string;
  research?: string | null;
  conversationSummary?: string | null;
  facts: HandoffFact[];
}
export function buildHandoffSummary(input: HandoffInput) {
  const known = input.facts.filter((f) => f.fact_value !== "not_determined");
  const evidence = known.map(
    (f) =>
      `- ${f.fact_key}: ${f.fact_value} (${f.source_type}, ${Math.round(f.confidence * 100)}%)${f.source_excerpt ? ` — ${f.source_excerpt.slice(0, 180)}` : ""}`,
  );
  return [
    `Lead: ${input.name}${input.title ? `, ${input.title}` : ""}${input.company ? ` at ${input.company}` : ""}`,
    `Qualification: ${input.bucket} | Status: ${input.leadStatus}`,
    `Recommended next action: ${input.nextAction}`,
    input.conversationSummary
      ? `Latest conversation: ${input.conversationSummary.slice(0, 500)}`
      : null,
    input.research ? `Research context: ${input.research.slice(0, 500)}` : null,
    evidence.length
      ? `Qualification evidence:\n${evidence.join("\n")}`
      : "Qualification evidence: not determined",
  ]
    .filter(Boolean)
    .join("\n\n");
}
