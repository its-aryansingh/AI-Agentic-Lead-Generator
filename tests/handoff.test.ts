import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildHandoffSummary} from '@/lib/handoff'

test('handoff includes identity, sourced facts and next action',()=>{
 const text=buildHandoffSummary({name:'Priya',company:'Acme',title:'VP Sales',bucket:'hot',leadStatus:'qualified',nextAction:'human_handoff',conversationSummary:'Asked for a meeting.',facts:[{fact_key:'meeting_intent',fact_value:'requested',source_type:'voice',source_excerpt:'Book Tuesday',confidence:.9}]})
 assert.match(text,/Priya, VP Sales at Acme/)
 assert.match(text,/meeting_intent: requested \(voice, 90%\)/)
 assert.match(text,/human_handoff/)
})

test('handoff never invents unknown facts',()=>{
 const text=buildHandoffSummary({name:'Alex',bucket:'warm',leadStatus:'engaged',nextAction:'follow_up',facts:[{fact_key:'budget',fact_value:'not_determined',source_type:'not_determined',confidence:0}]})
 assert.doesNotMatch(text,/budget:/)
 assert.match(text,/not determined/)
})
