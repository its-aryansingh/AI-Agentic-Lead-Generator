import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extractQualificationFacts,qualificationBucket,workflowForQualification} from '@/lib/qualification'

test('positive meeting reply is deterministically hot with cited evidence',()=>{
 const body='Interested. Our team needs this next month. Can we schedule a 20-min call?'
 const facts=extractQualificationFacts(body,'interested',true)
 assert.equal(qualificationBucket(facts,'interested'),'hot')
 assert.equal(facts.find(f=>f.fact_key==='timeline')?.source_type,'reply')
 assert.match(facts.find(f=>f.fact_key==='timeline')?.source_excerpt??'',/next month/i)
 assert.deepEqual(workflowForQualification('hot','interested'),{lead_status:'qualified',next_action:'human_handoff'})
})

test('unstated qualification facts remain not_determined',()=>{
 const facts=extractQualificationFacts('Tell me more.','question',false)
 const budget=facts.find(f=>f.fact_key==='budget')!
 assert.equal(budget.fact_value,'not_determined')
 assert.equal(budget.source_type,'not_determined')
 assert.equal(budget.confidence,0)
 assert.equal(qualificationBucket(facts,'question'),'warm')
})

test('unsubscribe is disqualified and do-not-contact',()=>{
 const facts=extractQualificationFacts('Remove me please.','unsubscribe',false)
 assert.equal(qualificationBucket(facts,'unsubscribe'),'disqualified')
 assert.deepEqual(workflowForQualification('disqualified','unsubscribe'),{lead_status:'do_not_contact',next_action:'none'})
})

test('voice transcript facts retain voice provenance',()=>{
 const facts=extractQualificationFacts('Interested, schedule a call next week.','interested',true,'voice')
 assert.equal(facts.find(f=>f.fact_key==='interest')?.source_type,'voice')
 assert.equal(facts.find(f=>f.fact_key==='timeline')?.source_type,'voice')
})
