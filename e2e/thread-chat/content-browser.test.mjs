import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import { chromium } from "playwright-core"

/** 真实 React/Lexical 输入框检查。仅附件 HTTP 使用替身；不是模型 E2E。 */
export async function runContentChecks(page) {
 const editor=page.locator('[contenteditable="true"]');await editor.waitFor({timeout:15000})
 const initialHeight=await page.evaluate(()=>document.documentElement.scrollHeight)
 await editor.fill('比较 @');await page.locator('.composer-artifact-menu').waitFor()
 assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),initialHeight)
 console.log('TOP_MENU',await page.locator('.composer-artifact-menu').boundingBox())
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');console.log('SELECTED',await editor.textContent())
 await page.keyboard.type(' 继续');await page.keyboard.press('Enter');console.log('SUBMITTED',await page.getByTestId('submitted').textContent())
 await page.getByText('切换底部输入框').click();await editor.fill('比较 @');await page.locator('.composer-artifact-menu').waitFor()
 const rect=await page.locator('.composer-artifact-menu').boundingBox()
 console.log('BOTTOM_MENU',JSON.stringify({rect,viewport:700,visible:rect.y>=0&&rect.y+rect.height<=700,scrollHeight:await page.evaluate(()=>document.documentElement.scrollHeight)}))
 await page.getByText('完整输入框',{exact:true}).click()
 await editor.fill('A 草稿');await page.getByText('切换 Thread',{exact:true}).click()
 assert.equal(await editor.textContent(),'')
 await editor.fill('B 草稿');await page.getByText('切换 Thread',{exact:true}).click()
 assert.equal(await editor.textContent(),'A 草稿')
 await page.getByText('切换视图',{exact:true}).click();assert.equal(await editor.textContent(),'A 草稿')
 await page.getByRole('button',{name:'发送',exact:true}).click()
 await editor.press('End');await page.keyboard.type(' 后续输入')
 await page.getByText('完成发送',{exact:true}).click()
 assert.equal(await editor.textContent(),'A 草稿 后续输入')
 await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByText('发送失败',{exact:true}).click()
 assert.equal(await editor.textContent(),'A 草稿 后续输入')
 await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByText('切换 Thread',{exact:true}).click()
 await page.getByText('完成发送',{exact:true}).click();assert.equal(await editor.textContent(),'B 草稿')
 await page.getByText('切换 Thread',{exact:true}).click();assert.equal(await editor.textContent(),'')
 await editor.fill('问题 @');await page.locator('.composer-artifact-menu').waitFor();await page.keyboard.press('Enter')
 assert.equal(await editor.locator('.composer-capsule').count(),1)
 await page.keyboard.press('Backspace');assert.equal(await editor.locator('.composer-capsule').count(),0)
 await page.keyboard.press('Control+z');assert.equal(await editor.locator('.composer-capsule').count(),1)
 await page.route('**/api/attachments',route=>route.fulfill({json:{id:'10000000-0000-4000-8000-000000000050',uploadUrl:new URL('/test-upload',page.url()).href}}))
 await page.route('**/test-upload',route=>route.fulfill({status:200,body:''}))
 let ingest
 await page.route('**/api/attachments/*/ingest',route=>{ingest=route})
 await page.locator('input[type=file]').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('附件正文')})
 await page.waitForFunction(()=>document.querySelector('[contenteditable]')?.textContent?.includes('上传中'))
 await page.getByText('切换 Thread',{exact:true}).click()
 for(let attempts=0;!ingest&&attempts<500;attempts++) await new Promise(r=>setTimeout(r,20))
 assert.ok(ingest,"附件处理请求应已发出")
 await ingest.fulfill({json:{}})
 await page.getByText('切换 Thread',{exact:true}).click()
 await page.waitForFunction(()=>!document.querySelector('[contenteditable]')?.textContent?.includes('上传中'))
 assert.equal(await editor.locator('.composer-capsule').count(),2)
 await editor.press('End');await page.keyboard.type(' 文件之后')
 await page.getByRole('button',{name:'发送',exact:true}).click()
 assert.deepEqual(JSON.parse(await page.getByTestId('submitted').textContent()).parts.map(part=>part.type),['text','artifact-reference','file','text'])
 await page.getByText('完成发送',{exact:true}).click()
 console.log('PASS 原子删除/撤销、跨 Thread 上传完成与正文/引用/附件提交保序（上传网络替身）')
 console.log('PASS 实际输入框：Thread/列画布草稿恢复、发送失败保留、迟到成功不清除新输入或其他 Thread')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await page.goto(process.env.TEST_BASE_URL || "http://localhost:3000/thread-chat-gate-3-harness/content")
    await runContentChecks(page)
  } finally { await browser.close() }
}
