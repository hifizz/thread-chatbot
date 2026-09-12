// 显式 NODE_OPTIONS 注入，仅用于开发验收，不在生产代码开放测试开关。
import { readFileSync, appendFileSync } from 'node:fs'
import { documents, origin } from './research-acceptance-fixtures.mjs'
const control = process.env.RESEARCH_ACCEPTANCE_CONTROL
if (control && process.env.NODE_ENV !== 'production') {
  const original = globalThis.fetch
  const counts = new Map()
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let config
    try { config=JSON.parse(readFileSync(control,'utf8')) } catch { return original(input,init) }
    if (!config.id) return original(input,init)
    const request = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : {}
    const log = (data) => appendFileSync(config.log,JSON.stringify({at:new Date().toISOString(),case:config.id,...data})+'\n',{mode:0o600})
    if (request.model === 'gpt-5.6-luna') {
      log({kind:'model-input',request})
      const response=await original(input,init)
      response.clone().text().then(body=>log({kind:'model-output',status:response.status,body})).catch(()=>{})
      return response
    }
    if (!/^https:\/\/(?:api\.anysearch\.com|api\.exa\.ai)\//.test(url)) return original(input,init)
    const target=request.params?.arguments?.url ?? request.urls?.[0]
    const key=config.id+':'+target
    const count=(counts.get(key)??0)+1; counts.set(key,count)
    log({kind:'provider-start',url,target,request})
    let response
    const failure=()=>Response.json({result:{isError:true,content:[{type:'text',text:'Controlled extraction failure'}]}})
    if (['A2','A5'].includes(config.id)) response=await original(input,init)
    else if (target) {
      const name=target.startsWith(origin)?new URL(target).pathname.slice(1):''
      if (name==='slow') {
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(resolve,120_000)
          const abort=()=>{clearTimeout(timer);log({kind:'provider-aborted',target});reject(init.signal.reason)}
          if(init?.signal?.aborted) abort(); else init?.signal?.addEventListener('abort',abort,{once:true})
        })
      }
      if (['C6','C7'].includes(config.id) || ['unavailable','broken','retention'].includes(name) || (config.id==='C1'&&!url.includes('exa.ai')) || !name) response=failure()
      else {
        const content= name==='versioned'&&count>1 ? '# Version B\nB-END' : documents[name] ?? (name.startsWith('product-')?`# ${name}\n价格 ${name.slice(8)} 元，部署在 Linux，日志保留 19 天。`:'# 测试正文\n没有额外信息。')
        response=url.includes('exa.ai')?Response.json({results:[{url:target,text:content}]}):Response.json({result:{structuredContent:{content}}})
      }
    } else {
      const names=({C2:['broken','deployment'],C3:['repost'],C5:['price','retention'],D1:['export'],E3:['deployment','price','export','current']})[config.id]??[]
      response=Response.json({results:names.map(name=>({title:name==='repost'?'Nacre-731 官方同文转载':`Nacre-731 ${name} 官方资料`,url:`${origin}/${name}`,snippet:name==='export'?'支持导出，具体套餐限制请查原文。':name==='repost'?'原文 /unavailable 的官方同文转载，版本 7.3。':'请阅读正文核实具体要求。'}))})
    }
    log({kind:'provider-end',url,target,status:response.status})
    return response
  }
}
