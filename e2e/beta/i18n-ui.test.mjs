import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js'
import { I18nProvider } from '../../lib/i18n/client.tsx'
import Landing from '../../components/landing/landing.tsx'
import { englishScenarios } from '../../constants/landing-demo-en.ts'
import { scenarios } from '../../constants/landing-demo.ts'

globalThis.React = React
const router = { refresh(){}, push(){}, replace(){}, prefetch(){}, back(){}, forward(){} }
function render(locale) {
  return renderToString(React.createElement(AppRouterContext.Provider,{value:router},
    React.createElement(I18nProvider,{locale},React.createElement(Landing))))
}
test('英文首页 SSR 没有中文闪屏或未翻译的场景',()=> {
  const html=render('en')
  assert.ok(html.includes('lang="en"'))
  assert.ok(html.includes('Design branching in ThreadChat'))
  assert.ok(html.includes('Read side by side and compare the details'))
  const withoutLanguageOption=html.replaceAll('简体中文','')
  assert.equal(/[\u4e00-\u9fff]/u.test(withoutLanguageOption),false)
})
test('中文首页 SSR 保留原版核心文案',()=> {
  const html=render('zh-CN')
  assert.ok(html.includes('lang="zh-CN"'))
  assert.ok(html.includes('能开分叉'))
  assert.ok(html.includes('设计 ThreadChat 的分叉功能'))
})
test('六套双语演示保留相同标识、三条分支和来源',()=> {
  assert.deepEqual(englishScenarios.map(s=>s.id),scenarios.map(s=>s.id))
  for (const [index, english] of englishScenarios.entries()) {
    assert.equal(english.lanes.length,3)
    assert.deepEqual(english.sources?.map(s=>s.url),scenarios[index].sources?.map(s=>s.url))
    for (const [i,lane] of english.lanes.entries()) {
      assert.ok(lane.title && lane.text && lane.question && lane.heading)
      if(i<2)assert.ok(lane.anchor)
      for(const row of lane.rows??[])assert.equal(row.length,2)
    }
  }
})
