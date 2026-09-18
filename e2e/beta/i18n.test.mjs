import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolveLocale, matchAcceptLanguage } from '../../lib/i18n/resolve-locale.ts'
import { createTranslator, formatCredit } from '../../lib/i18n/dictionary.ts'
import { saveLocalePreference } from '../../lib/i18n/locale-preference.ts'
import { verificationEmail, resetPasswordEmail, localizedEmail, authEmailLocale } from '../../lib/email/templates.ts'
import { localizeError } from '../../lib/i18n/errors.ts'
import { readJsonBody } from '../../lib/http/json-body.ts'
import { safeReturnPath } from '../../lib/http/return-path.ts'
import { isSameOrigin } from '../../lib/http/same-origin.ts'
import { responseLanguageInstruction } from '../../lib/i18n/response-language.ts'

test('浏览器语言 q 权重、零权重、无效字段和中文变体', () => {
  assert.equal(matchAcceptLanguage('en;q=0.8,zh-TW;q=0.9'), 'zh-CN')
  assert.equal(matchAcceptLanguage('zh;q=0,en;q=0.3'), 'en')
  assert.equal(matchAcceptLanguage('zh;q=2,en;q=0.4'), 'en')
  assert.equal(matchAcceptLanguage('en;q=0,*;q=0.8'), 'zh-CN')
  assert.equal(matchAcceptLanguage('ja,de'), null)
  assert.equal(matchAcceptLanguage('zh;q=abc'), null)
  assert.equal(matchAcceptLanguage('en;q=0,zh;q=0'), null)
  assert.equal(matchAcceptLanguage('zh-Hans-CN'), 'zh-CN')
})
test('显式偏好优先，非法 cookie 不作为词典路径', () => {
  assert.deepEqual(resolveLocale({profile:'en',cookie:'zh-CN',acceptLanguage:'zh'}), {locale:'en',source:'profile'})
  assert.deepEqual(resolveLocale({cookie:'zh-CN',acceptLanguage:'en'}), {locale:'zh-CN',source:'cookie'})
  assert.deepEqual(resolveLocale({cookie:'../../en',acceptLanguage:'en'}), {locale:'en',source:'accept-language'})
  assert.deepEqual(resolveLocale({acceptLanguage:'ja'}), {locale:'en',source:'default'})
})
test('两套词典 key 和模板变量严格一致', async () => {
  const zh = JSON.parse(await readFile(new URL('../../messages/zh-CN.json', import.meta.url)))
  const en = JSON.parse(await readFile(new URL('../../messages/en.json', import.meta.url)))
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  const variables = value => [...value.matchAll(/\{([\w]+)\}/g)].map(m=>m[1]).sort()
  for (const key of Object.keys(zh)) {
    assert.equal(typeof en[key], 'string', key)
    assert.ok(en[key].trim(), key)
    assert.deepEqual(variables(zh[key]), variables(en[key]), key)
  }
  assert.throws(()=>createTranslator('en')('missing.key'), /missing|Missing|MISSING/i)
  assert.equal(formatCredit('en',5_000_000).includes('5.00'),true)
})
test('账户保存失败只声明当前设备已保存', async () => {
  assert.deepEqual(await saveLocalePreference('en',null,()=>{throw Error('should not run')}), {locale:'en',persisted:'device'})
  assert.deepEqual(await saveLocalePreference('en','u',async()=>{}), {locale:'en',persisted:'account'})
  assert.deepEqual(await saveLocalePreference('en','u',async()=>{throw Error('db failed')}), {locale:'en',persisted:'device',code:'LOCALE_SYNC_FAILED'})
})
test('交易邮件双语、纯文本和 XSS 转义', () => {
  for (const locale of ['zh-CN','en']) {
    for (const make of [verificationEmail,resetPasswordEmail]) {
      const email=make('https://threadchat.example/verify?token=a&x=b',locale)
      assert.ok(email.subject && email.text)
      assert.ok(email.html.includes(`lang="${locale}"`))
      assert.ok(email.html.includes('token=a&amp;x=b'))
    }
    const invite=localizedEmail({locale,template:'beta-invite',variables:{url:'https://threadchat.example/invite',expiresAt:'<script>alert(1)</script>'}})
    assert.equal(invite.html.includes('<script>'),false)
  }
  assert.throws(()=>verificationEmail('javascript:alert(1)','en'))
  assert.equal(authEmailLocale(null,new Request('https://example.test',{headers:{'accept-language':'zh-TW'}})),'zh-CN')
  assert.equal(authEmailLocale('en',new Request('https://example.test',{headers:{'cookie':'tc-locale=zh-CN'}})),'en')
})
test('未知供应商错误不泄漏原始字符串',()=> {
  const value=localizeError('en',{message:'api_key=private',code:'PROVIDER_UNKNOWN'})
  assert.equal(value.includes('private'),false)
  assert.equal(localizeError('en',{code:'CREDIT_EXHAUSTED'}),createTranslator('en')('errors.creditExhausted'))
  assert.equal(responseLanguageInstruction('en').includes("explicit response-language"),true)
})
test('同源写入和返回路径不能绕过边界',()=> {
  const old=process.env.BETTER_AUTH_URL
  delete process.env.BETTER_AUTH_URL
  try {
    assert.equal(isSameOrigin(new Request('https://example.test/api',{headers:{Origin:'https://example.test'}})),true)
    assert.equal(isSameOrigin(new Request('https://example.test/api',{headers:{Origin:'https://evil.test'}})),false)
    assert.equal(isSameOrigin(new Request('https://example.test/api')),false)
  } finally { if(old===undefined)delete process.env.BETTER_AUTH_URL;else process.env.BETTER_AUTH_URL=old }
  assert.equal(safeReturnPath('//evil.test','/'),'/')
  assert.equal(safeReturnPath('/%2fevil.test','/'),'/')
  assert.equal(safeReturnPath('/thread-chat/123?x=1','/'),'/thread-chat/123?x=1')
})
test('JSON 请求在读取期间受字节限制',async()=> {
  const request=body=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body})
  assert.deepEqual(await readJsonBody(request('{"a":1}'),32),{a:1})
  await assert.rejects(()=>readJsonBody(request('"'+ 'x'.repeat(100)+'"'),32))
  await assert.rejects(()=>readJsonBody(request('{bad'),32))
})
