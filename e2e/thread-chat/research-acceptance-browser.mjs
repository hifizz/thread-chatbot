import { writeFile } from 'node:fs/promises'
import { cases } from './research-acceptance-fixtures.mjs'
const directory = '/tmp/research-luna-evidence'
export async function startCase(page, id) {
  const item=cases.find(item=>item.id===id)
  if (!item) throw new Error('Unknown case')
  const old=await page.url()
  await page.click('loc=role:button[name="新对话"]')
  await page.waitForFunction((old)=>location.href!==old && Boolean(document.querySelector('[contenteditable="true"]')),old,{timeout:15000})
  const model=await page.evaluate(()=>document.querySelector('button[aria-label="选择对话模型"]')?.textContent)
  if(!model?.includes('GPT-5.6 Luna')) throw new Error('验收模型必须为 GPT-5.6 Luna')
  await writeFile(`${directory}/control.json`,JSON.stringify({id,log:`${directory}/${id}-wire.jsonl`}))
  await page.fill('loc=css:[contenteditable="true"]',item.prompt)
  await page.click('loc=css:button[aria-label="发送"]')
  await page.waitForSelector('loc=css:button[aria-label="停止生成"]',{state:'visible',timeout:15000})
  console.log({started:id,url:await page.url(),expected:item.expected})
}
export async function finishCase(page,id) {
  try { await page.waitForSelector('loc=css:button[aria-label="停止生成"]',{state:'hidden',timeout:45000}) }
  catch { console.log({pending:id}); return false }
  const snapshot=await page.snapshot({scope:'full_page'})
  await writeFile(`${directory}/${id}-snapshot.txt`,snapshot)
  await writeFile(`${directory}/${id}-url.txt`,await page.url())
  await page.screenshot({path:`${directory}/${id}.png`})
  await page.evaluate(()=>{const list=document.querySelector('.msg-list');if(list)list.scrollTop=0})
  await page.screenshot({path:`${directory}/${id}-top.png`})
  console.log({completed:id,screenshot:`${directory}/${id}.png`,text:await page.evaluate(()=>document.querySelector('.msg-list')?.innerText?.slice(-4500))})
  return true
}
