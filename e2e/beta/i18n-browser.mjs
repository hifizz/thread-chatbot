/** 隔离 Beta 数据库的浏览器验收；不调用模型/搜索/邮件供应商，不读取生产凭据。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const base='http://localhost:3100'
const database=new URL(process.env.DATABASE_URL??'postgres://invalid/invalid')
assert.match(database.hostname,/^(localhost|127\.0\.0\.1)$/,'仅允许本机隔离数据库')
assert.equal(database.pathname,'/thread_chat_eval_beta','拒绝非 Beta 验收库')
assert.equal(process.env.BETTER_AUTH_URL,base)
for(const key of ['RESEND_API_KEY','TOKEN_ROUTER_API_KEY','ANYSEARCH_API_KEY','EXA_API_KEY','PARALLEL_API_KEY'])assert.ok(!process.env[key],`验收不使用 ${key}`)
const output=[]
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--port','3100'],{
  env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
})
server.stdout.on('data',chunk=>output.push(chunk.toString()))
server.stderr.on('data',chunk=>output.push(chunk.toString()))
let browser
const results=[]
const errors=[]
const addPage=async(context)=>{
  const page=await context.newPage()
  page.on('pageerror',error=>errors.push(error.message))
  return page
}
try {
  await mkdir('test-results/beta',{recursive:true})
  let ready=false
  for(let attempt=0;attempt<120;attempt++){
    if(server.exitCode!==null)throw Error('Next.js 验收服务提前退出')
    try {const response=await fetch(`${base}/`);if(response.ok){ready=true;break}}catch{}
    await delay(1000)
  }
  assert.ok(ready,'Next.js 服务就绪')
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']})
  const anonymous=await browser.newContext({locale:'en-US',viewport:{width:1360,height:900}})
  const page=await addPage(anonymous)
  await page.goto(base,{waitUntil:'networkidle'})
  assert.equal(await page.locator('html').getAttribute('lang'),'en')
  await page.getByRole('heading',{name:'Design branching in ThreadChat'}).waitFor()
  assert.equal((await anonymous.cookies()).some(c=>c.name==='tc-locale'),false,'自动识别不固化为手动语言 cookie')
  await page.screenshot({path:'test-results/beta/home-en-desktop.png'})
  await page.getByRole('combobox').first().selectOption('zh-CN')
  await page.getByRole('heading',{name:'设计 ThreadChat 的分叉功能'}).waitFor()
  await page.reload({waitUntil:'networkidle'})
  assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN')
  results.push({case:'anonymous-browser-and-device-preference',status:'pass'})
  const mobile=await browser.newContext({locale:'zh-TW',viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  const mobilePage=await addPage(mobile)
  await mobilePage.goto(base,{waitUntil:'networkidle'})
  assert.equal(await mobilePage.locator('html').getAttribute('lang'),'zh-CN')
  assert.ok(await mobilePage.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+2),'移动端页面不横向溢出')
  await mobilePage.screenshot({path:'test-results/beta/home-zh-mobile.png'})
  await mobilePage.goto(`${base}/sign-in`,{waitUntil:'networkidle'})
  assert.equal(await mobilePage.locator('html').getAttribute('lang'),'zh-CN')
  results.push({case:'mobile-zh-hant-fallback-and-auth',status:'pass'})
  // 真正经过 Better Auth 与隔离 Postgres 的账户偏好保存，不 mock locale API。
  const account=await browser.newContext({locale:'en-US',viewport:{width:1360,height:900}})
  const signup=await account.request.post(`${base}/api/auth/sign-up/email`,{
    headers:{Origin:base},data:{name:'Beta Locale Test',email:`locale-${Date.now()}@example.invalid`,password:'OnlyForIsolatedBetaTest-2026!'},
  })
  assert.ok(signup.ok(),`测试注册状态 ${signup.status()}`)
  const accountPage=await addPage(account)
  await accountPage.goto(`${base}/account`,{waitUntil:'networkidle'})
  assert.ok(accountPage.url().endsWith('/account'))
  const update=accountPage.waitForResponse(response=>response.url().endsWith('/api/settings/locale')&&response.request().method()==='PATCH')
  await accountPage.getByRole('combobox').first().selectOption('zh-CN')
  assert.deepEqual(await (await update).json(),{locale:'zh-CN',persisted:'account'})
  const state=await account.storageState()
  state.cookies=state.cookies.filter(c=>c.name!=='tc-locale')
  const otherDevice=await browser.newContext({locale:'en-US',storageState:state})
  const otherPage=await addPage(otherDevice)
  await otherPage.goto(`${base}/account`,{waitUntil:'networkidle'})
  assert.equal(await otherPage.locator('html').getAttribute('lang'),'zh-CN','账户偏好覆盖浏览器且不依赖设备 cookie')
  const rejected=await account.request.patch(`${base}/api/settings/locale`,{headers:{Origin:'https://evil.invalid'},data:{locale:'en'}})
  assert.equal(rejected.status(),403)
  const invalid=await account.request.patch(`${base}/api/settings/locale`,{headers:{Origin:base},data:{locale:'../../en'}})
  assert.equal(invalid.status(),400)
  const fresh=await browser.newContext({locale:'en-US'})
  const freshPage=await addPage(fresh)
  await freshPage.goto(base,{waitUntil:'networkidle'})
  assert.equal(await freshPage.locator('html').getAttribute('lang'),'en','不跨用户缓存账户语言')
  results.push({case:'account-persistence-cross-device-and-origin-validation',status:'pass'})
  assert.deepEqual(errors,[],'浏览器没有运行时错误')
  console.log(JSON.stringify({status:'pass',results},null,2))
} catch(error) {
  console.error(error)
  process.exitCode=1
} finally {
  await writeFile('test-results/beta/i18n-browser.json',JSON.stringify({results,errors},null,2))
  await writeFile('test-results/beta/i18n-server.log',output.join(''))
  await browser?.close()
  server.kill('SIGTERM')
}
