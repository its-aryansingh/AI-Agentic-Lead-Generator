export function redactPii(input: string) {
 return input
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[EMAIL]')
  .replace(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+\/?/gi,'[LINKEDIN_PROFILE]')
  .replace(/\+?\d[\d\s().-]{7,}\d/g,'[PHONE]')
}
export type ApprovedExample={id:string;example_type:'email'|'call_transcript';title:string;redacted_content:string;extracted_guidance?:string|null}
export function composePlaybookGuidance(examples: ApprovedExample[]) {
 if(!examples.length)return ''
 return ['APPROVED PLAYBOOK GUIDANCE:',
  'Examples below are style and conversation-pattern references only.',
  'Never copy names, companies, metrics, outcomes, needs, or claims from an old example into a new prospect message.',
  'Use a factual claim only when it is supported by the current prospect research or approved customer context.',
  ...examples.map((e,i)=>`Example ${i+1} (${e.example_type}):\n${e.extracted_guidance??e.redacted_content}`),
 ].join('\n\n')
}
export function contextSnapshot(context: Record<string,unknown>|null,examples:ApprovedExample[]){
 if(!context)return null
 const {user_id:_,created_at:__,updated_at:___,...approvedContext}=context
 return {context:approvedContext,approved_example_ids:examples.map(e=>e.id)}
}
