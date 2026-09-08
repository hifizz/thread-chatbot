import assert from "node:assert/strict"
import { installComposerUploadStub } from "./composer-upload-stub.mjs"

/**
 * 通过 ego-browser nodejs 注入其 helper 后运行，禁止独立启动 Playwright。
 * 入口与分段执行示例见 content-browser.md；分段避免长时间没有进度反馈。
 */
export async function runContentChecks({ js, click: clickElement, typeText: insertText, pressKey: pressSingleKey, wait, cdp, cliLog }, section) {
  const click = async (target) => { await clickElement(target); await wait(0.15) }
  const typeText = async (value) => { await insertText(value); await wait(0.15) }
  const pressKey = async (key) => {
    if (key.startsWith('Meta+')) {
      const name = key.slice(5)
      const command = { A: 'selectAll', Z: 'undo', End: 'moveToEndOfDocument' }[name]
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: name, modifiers: 4, commands: [command] })
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: name, modifiers: 4 })
    } else await pressSingleKey(key)
    await wait(0.15)
  }
  const editor = '[contenteditable="true"]'
  const text = () => js('document.querySelector("[contenteditable]")?.textContent')
  const check = async (expression, description) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await js(expression)) return
      await wait(0.1)
    }
    assert.fail(description)
  }
  const fill = async (value) => {
    await click(editor)
    await pressKey('Meta+A')
    await pressKey('Backspace')
    await typeText(value)
    await check(`document.querySelector('[contenteditable]').textContent === ${JSON.stringify(value)}`, '输入值应落在编辑器中')
  }
  const control = (id) => click(`[data-testid="${id}"]`)
  const capsuleCount = (count) => check(`document.querySelectorAll('[contenteditable] .composer-capsule').length === ${count}`, `胶囊数量应为 ${count}`)
  const send = () => click('[data-slot="composer-send"]')
  const paste = (setup) => js(`(() => {
    const data = new DataTransfer(); ${setup}
    document.querySelector('[contenteditable]').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    return true;
  })()`)

  if (section === 'references') {
    await control('full-composer')
    await fill('比较 @')
    await check(`document.querySelector('[role="listbox"] [role="option"]')?.getAttribute('aria-selected') === 'true'`, '首项应高亮')
    await pressKey('ArrowDown')
    await check(`document.querySelectorAll('[role="option"]')[1]?.getAttribute('aria-selected') === 'true'`, '向下键应选择第二项')
    await pressKey('Enter')
    await capsuleCount(1)
    await typeText(' 后续文字')
    assert.match(await text(), /测试文档 2.*后续文字/)
    await click('[contenteditable] .composer-capsule-action')
    await check(`document.querySelector('[data-testid="submitted"]').textContent.startsWith('preview:')`, '胶囊点击应打开对应 Artifact')
    await typeText('X')
    await capsuleCount(1)
    // 应用内剪贴板协议经过真实 Lexical copy/paste，不把引用退化为普通文字。
    await click(editor)
    await pressKey('Meta+A')
    await js(`(() => {
      const data = new DataTransfer();
      document.querySelector('[contenteditable]').dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
      window.__composerClipboard = data;
      return data.types;
    })()`)
    await pressKey('Meta+End')
    await check('window.getSelection()?.isCollapsed === true', '粘贴前选区应折叠到正文末尾')
    await js(`document.querySelector('[contenteditable]').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: window.__composerClipboard }))`)
    await capsuleCount(2)
    await fill('问题 @不存在的标题')
    await check(`document.querySelector('[role="listbox"] [role="status"]') !== null`, '空候选应显示提示')
    await pressKey('Enter')
    assert.equal(await text(), '问题 @不存在的标题')
    await pressKey('Escape')
    await check(`!document.querySelector('[role="listbox"]')`, 'Escape 应关闭菜单')
    await fill('问题 @')
    await pressKey('Enter')
    await capsuleCount(1)
    await pressKey('Backspace') // 先删除插入胶囊时保留的文字落点空格。
    await capsuleCount(1)
    await pressKey('Backspace')
    await capsuleCount(0)
    await pressKey('Meta+Z')
    await capsuleCount(1)
    await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 700, deviceScaleFactor: 1, mobile: false })
    await fill('问题 @')
    await check(`(() => { const r = document.querySelector('[role="listbox"]')?.getBoundingClientRect(); return r && r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight })()`, '窄视口菜单应完整可见')
    await js(`document.querySelector('section').style.transform = 'translate(12px, 40px) scale(0.75)'`)
    await check(`(() => { const r = document.querySelector('[role="listbox"]')?.getBoundingClientRect(); return r && r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight })()`, '画布缩放下菜单应完整可见')
    await pressKey('Escape')
    await js(`document.querySelector('section').style.transform = ''`)
    await cdp('Emulation.clearDeviceMetricsOverride')
    cliLog('PASS 引用候选、空结果、点击预览、原子删除/撤销、应用内剪贴板与窄屏定位')
  }

  if (section === 'drafts') {
    await fill('A 草稿')
    await control('switch-thread')
    assert.equal(await text(), '')
    await fill('B 草稿')
    await control('switch-thread')
    assert.equal(await text(), 'A 草稿')
    await control('switch-view')
    assert.equal(await text(), 'A 草稿')
    await send()
    await check(`document.querySelector('[contenteditable]')?.getAttribute('contenteditable') === 'false'`, '提交期间应禁用编辑')
    await control('fail-send')
    await check(`document.querySelector('[contenteditable="true"]') !== null`, '失败应恢复编辑')
    assert.equal(await text(), 'A 草稿')
    await send()
    await control('switch-thread')
    await control('finish-send')
    assert.equal(await text(), 'B 草稿')
    await control('switch-thread')
    await check(`document.querySelector('[contenteditable]').textContent === ''`, '成功应清空原 Thread 草稿')
    // 旧视图提交后卸载，新视图继续编辑：迟到成功不得清除新草稿。
    await fill('原草稿')
    await send()
    await control('switch-view')
    await fill('新草稿')
    await control('finish-send')
    assert.equal(await text(), '新草稿')
    cliLog('PASS Thread/视图切换、提交禁用、失败保留与迟到成功保护')
  }

  if (section === 'attachments') {
    await js(`(${installComposerUploadStub.toString()})()`)
    await fill('阅读附件 ')
    await paste(`data.setData('text/plain', '短文本')`)
    await check(`document.querySelector('[contenteditable]').textContent.includes('短文本')`, '短文本应插入正文')
    assert.equal(await js('window.__composerUploads.created.length'), 0)
    await paste(`data.setData('text/plain', '长'.repeat(4001))`)
    await check(`document.querySelector('[data-slot="composer-attachment"][data-state="done"]') !== null`, '长文本应通过真实上传队列形成附件')
    assert.ok(!(await text()).includes('长'))
    await js(`window.__composerUploads.hold = true`)
    await paste(`data.items.add(new File(['正文'], 'same.txt', {type:'text/plain'}))`)
    await check(`window.__composerUploads.pending.length === 1`, '粘贴文件应启动上传')
    await check(`document.querySelector('[data-slot="composer-send"]').disabled`, '上传未完成应禁止发送')
    await control('switch-thread')
    await js(`window.__composerUploads.hold = false; window.__composerUploads.pending.splice(0).forEach(resolve => resolve())`)
    await control('switch-thread')
    await check(`document.querySelectorAll('[data-slot="composer-attachment"][data-state="done"]').length === 2`, '切换 Thread 后上传结果应保留')
    await js(`(() => {
      const data = new DataTransfer(); data.items.add(new File(['拖入'], 'same.txt', {type:'text/plain'}));
      document.querySelector('[data-slot="composer-bar"]').dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:data}));
    })()`)
    await check(`document.querySelectorAll('[data-slot="composer-attachment"][data-state="done"]').length === 3`, '同名拖入附件应独立上传')
    await js(`window.__composerUploads.failNext = true`)
    await paste(`data.items.add(new File(['重试'], 'retry.txt', {type:'text/plain'}))`)
    await check(`document.querySelector('[data-state="error"]') !== null`, '上传失败应显示失败卡片')
    await click('button[aria-label="重试上传 retry.txt"]')
    await check(`document.querySelectorAll('[data-slot="composer-attachment"][data-state="done"]').length === 4`, '重试应恢复就绪')
    await click('button[aria-label="移除 retry.txt"]')
    await check(`window.__composerUploads.deleted.length === 1`, '移除就绪附件应清理服务器文件')
    await paste(`const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1; const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0)); data.items.add(new File([bytes], 'pixel.png', {type:'image/png'}))`)
    await check(`document.querySelectorAll('[data-slot="composer-attachment"][data-state="done"]').length === 4`, '图片粘贴应完成图片预处理与上传')
    await click(editor)
    await pressKey('Meta+End')
    await typeText(' @')
    await pressKey('Enter')
    await capsuleCount(1)
    await send()
    const submitted = await js(`JSON.parse(document.querySelector('[data-testid="submitted"]').textContent)`)
    assert.equal(submitted.parts.filter(part => part.type === 'file').length, 4)
    assert.equal(submitted.parts.filter(part => part.type === 'artifact-reference').length, 1)
    assert.equal(submitted.parts.filter(part => part.type === 'file' && part.file.filename === 'same.txt').length, 2)
    await control('fail-send')
    await check(`document.querySelector('[contenteditable="true"]') !== null`, '发送失败应恢复输入')
    assert.equal(await js(`document.querySelectorAll('[data-slot="composer-attachment"]').length`), 4)
    await send()
    await control('finish-send')
    await check(`document.querySelectorAll('[data-slot="composer-attachment"]').length === 0 && document.querySelector('[contenteditable]').textContent === ''`, '发送成功应清空文字及附件')
    cliLog('PASS 长短文本/文件/图片粘贴、同名拖入、跨 Thread 上传、重试移除、真实发送内容及成功/失败清理')
  }

  if (section === 'editing') {
    await control('edit-message')
    await click('button[aria-label="重新编辑"]')
    await capsuleCount(4)
    const original = await text()
    await click(editor)
    await pressKey('Meta+End')
    await typeText(' 修改末尾')
    await click('.user-edit-actions button:not(.primary)')
    await click('button[aria-label="重新编辑"]')
    assert.equal(await text(), original)
    await click(editor)
    await pressKey('Meta+End')
    await typeText(' 修改末尾')
    await click('.user-edit-actions button.primary')
    const content = await js(`JSON.parse(document.querySelector('[data-testid="submitted"]').textContent)`)
    assert.deepEqual(content.parts.map(part => part.type), ['text', 'file', 'artifact-reference', 'quote', 'text', 'artifact-reference', 'text'])
    assert.equal(content.parts[2].artifactId, content.parts[5].artifactId)
    assert.deepEqual(content.parts[3].quote, { text: '旧 Quote 原文' })
    cliLog('PASS 旧 Quote、文件及重复 Artifact 混排编辑、取消恢复和提交保序')
  }
}
