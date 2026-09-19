import {test} from 'node:test'
import assert from 'node:assert/strict'
import {isRetryableLocalVoiceFailure,normalizeE164,phoneHash,validVoiceWebhookSignature,voiceWebhookSignature,withinCallingHours} from '@/lib/voice-compliance'

test('voice phone normalization accepts only E.164',()=>{assert.equal(normalizeE164('+91 98765 43210'),'+919876543210');assert.equal(normalizeE164('9876543210'),null)})
test('phone suppression hash is deterministic and hides phone',()=>{const hash=phoneHash('+919876543210');assert.equal(hash,phoneHash('+919876543210'));assert.equal(hash.includes('98765'),false)})
test('calling hours use recipient-configured timezone',()=>{assert.equal(withinCallingHours(new Date('2026-08-29T06:00:00Z'),'Asia/Kolkata',9,18),true);assert.equal(withinCallingHours(new Date('2026-08-29T18:00:00Z'),'Asia/Kolkata',9,18),false)})
test('only local provider request failures remain retryable',()=>{assert.equal(isRetryableLocalVoiceFailure({status:'failed',provider_status:'request_failed',provider_execution_id:null}),true);assert.equal(isRetryableLocalVoiceFailure({status:'failed',provider_status:'failed',provider_execution_id:'bolna-1'}),false);assert.equal(isRetryableLocalVoiceFailure({status:'completed',provider_status:'completed'}),false)})
test('rotating webhook version invalidates the previous signature',()=>{
 const previous=process.env.BOLNA_WEBHOOK_SECRET
 process.env.BOLNA_WEBHOOK_SECRET='test-only-secret'
 try{
  const versionOne=voiceWebhookSignature('connection-1',1)
  assert.equal(validVoiceWebhookSignature('connection-1',versionOne,1),true)
  assert.equal(validVoiceWebhookSignature('connection-1',versionOne,2),false)
 }finally{
  if(previous===undefined)delete process.env.BOLNA_WEBHOOK_SECRET
  else process.env.BOLNA_WEBHOOK_SECRET=previous
 }
})
