import {test} from 'node:test'
import assert from 'node:assert/strict'
import {composePlaybookGuidance,contextSnapshot,redactPii} from '@/lib/playbook'
test('redaction removes email phone and LinkedIn identifiers',()=>{
 const out=redactPii('Priya priya@acme.com +91 98765 43210 linkedin.com/in/priya-test')
 assert.equal(out.includes('priya@acme.com'),false);assert.match(out,/\[EMAIL\]/);assert.match(out,/\[PHONE\]/);assert.match(out,/\[LINKEDIN_PROFILE\]/)
})
test('playbook explicitly prohibits transferring old facts',()=>{
 const text=composePlaybookGuidance([{id:'1',example_type:'email',title:'x',redacted_content:'OldCo grew 90%'}])
 assert.match(text,/Never copy names, companies, metrics/)
})
test('snapshot keeps approved ids and drops ownership metadata',()=>{
 const snap=contextSnapshot({user_id:'u',created_at:'x',company_name:'Acme',version:2},[{id:'e',example_type:'email',title:'x',redacted_content:'ok'}])
 assert.deepEqual(snap,{context:{company_name:'Acme',version:2},approved_example_ids:['e']})
})
