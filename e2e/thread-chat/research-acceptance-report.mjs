// 从真实浏览器证据生成索引和机制统计；语义通过结论仍须人工核对。
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { cases } from './research-acceptance-fixtures.mjs'
const source=process.argv[2]??'/tmp/research-luna-evidence'
const destination='docs/testing/research-luna-acceptance'
await mkdir(`${destination}/screenshots`,{recursive:true})
await mkdir(`${destination}/transcripts`,{recursive:true})
const rows=[]
for(const item of cases) {
  let snapshot,events,url
  try {
    snapshot=await readFile(`${source}/${item.id}-snapshot.txt`,'utf8')
    events=(await readFile(`${source}/${item.id}-wire.jsonl`,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
    url=await readFile(`${source}/${item.id}-url.txt`,'utf8')
  } catch { rows.push({...item,status:'待完成'});continue }
  const outputs=new Map(),calls=new Map()
  const requests=events.filter(e=>e.kind==='model-input').map(e=>e.request)
  let parallelToolCalls=0
  for(const request of requests) for(const message of request.messages??[]) {
    parallelToolCalls=Math.max(parallelToolCalls,(message.tool_calls??[]).length)
    for(const call of message.tool_calls??[]) calls.set(call.id,call.function)
    if(message.role==='tool') {
      try {outputs.set(message.tool_call_id,JSON.parse(message.content))}catch{}
    }
  }
  const reads=[...outputs.entries()].filter(([,r])=>r.ok&&r.data?.range).map(([id,r])=>({id,url:r.data.url,docId:r.data.docId,range:r.data.range,totalChars:r.data.totalChars,cacheHit:r.data.cacheHit,fullyRead:r.data.fullyRead}))
  const successes=[...outputs.values()].filter(r=>r.ok)
  const contentChars=successes.reduce((sum,r)=>sum+JSON.stringify(r.data).length,0)
  const providerEvents=events.filter(e=>e.kind.startsWith('provider-')).map(({at,kind,target})=>({at,kind,target}))
  const providerCalls=providerEvents.filter(e=>e.kind==='provider-start').length
  const failures=[...outputs.values()].filter(r=>r.ok===false).map(r=>r.error.code)
  await copyFile(`${source}/${item.id}.png`,`${destination}/screenshots/${item.id}.png`)
  await copyFile(`${source}/${item.id}-top.png`,`${destination}/screenshots/${item.id}-top.png`)
  await writeFile(`${destination}/transcripts/${item.id}.txt`,snapshot)
  rows.push({...item,status:'待人工核对',url,model:'gpt-5.6-luna',modelRequests:requests.length,providerCalls,parallelToolCalls,contentChars,failures,reads,providerEvents,toolCalls:[...calls.values()]})
}
await writeFile(`${destination}/observations.json`,JSON.stringify(rows,null,2)+'\n')
console.log(rows.map(({id,status,providerCalls,contentChars})=>({id,status,providerCalls,contentChars})))
