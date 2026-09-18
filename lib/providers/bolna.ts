const BASE='https://api.bolna.ai'
async function request(apiKey:string,path:string,init?:RequestInit){
 const response=await fetch(`${BASE}${path}`,{...init,headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json',...(init?.headers??{})},signal:AbortSignal.timeout(20000)})
 const data=await response.json().catch(()=>({}))
 if(!response.ok)throw new Error(String((data as {message?:unknown}).message??`BOLNA_HTTP_${response.status}`))
 return data as Record<string,unknown>
}
export async function verifyBolnaConnection(apiKey:string,agentId:string){
 const data=await request(apiKey,`/v2/agent/${encodeURIComponent(agentId)}`)
 const id=String(data.agent_id??data.id??'')
 if(id&&id!==agentId)throw new Error('Bolna agent does not belong to this connection.')
 return data
}
export async function createBolnaCall(opts:{apiKey:string;agentId:string;recipientPhone:string;fromPhone?:string|null;userData:Record<string,string>}){
 const body:Record<string,unknown>={agent_id:opts.agentId,recipient_phone_number:opts.recipientPhone,user_data:opts.userData,retry_config:{enabled:false},bypass_call_guardrails:false}
 if(opts.fromPhone)body.from_phone_number=opts.fromPhone
 const data=await request(opts.apiKey,'/call',{method:'POST',body:JSON.stringify(body)})
 const executionId=String(data.execution_id??'')
 if(!executionId)throw new Error('Bolna did not return an execution ID.')
 return {executionId,status:String(data.status??'queued'),raw:data}
}
export async function getBolnaExecution(apiKey:string,executionId:string){return request(apiKey,`/executions/${encodeURIComponent(executionId)}`)}
