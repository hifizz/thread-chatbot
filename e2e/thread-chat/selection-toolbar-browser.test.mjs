import assert from "node:assert/strict"

/** 由 ego-browser nodejs 注入 helpers；复用开发 content harness，不调用模型。 */
export async function runSelectionToolbarChecks({ js, click: rawClick, typeText, pressKey, cdp, wait, cliLog }) {
  await js(`(() => {
    window.__quoteLifecycleErrors = [];
    window.__quoteOriginalConsoleError = console.error;
    console.error = (...args) => {
      const message = args.map(String).join(' ');
      if (message.includes('flushSync')) window.__quoteLifecycleErrors.push(message);
      window.__quoteOriginalConsoleError(...args);
    };
  })()`)
  const click = async (selector) => { await rawClick(selector); await wait(.2) }
  const read = () => js(`document.querySelector('[contenteditable]').textContent`)
  const quotes = () => js(`document.querySelectorAll('[contenteditable] .composer-capsule').length`)
  const select = async () => {
    await js(`(() => {
      const element = document.querySelector('[data-testid="selection-source"]');
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 12);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    })()`)
    await wait(.2)
  }
  const continueButton = '.selection-toolbar button:first-child'
  await click('[contenteditable]')
  await typeText('原有问题 @')
  await wait(.2)
  await pressKey('Enter')
  await wait(.2)
  const before = await read()
  assert.match(before, /原有问题.*测试文档/)
  await select()
  assert.equal(await js(`document.querySelectorAll('.selection-toolbar button').length`), 2)
  assert.equal(await js(`!!document.querySelector('.sel-bubble')`), false)
  assert.equal(await js(`(() => { const a = window.getSelection().getRangeAt(0).getBoundingClientRect(); const b = document.querySelector('.selection-toolbar').getBoundingClientRect(); return b.bottom <= a.top && b.left >= 0 && b.right <= innerWidth })()`), true)
  await click(continueButton)
  assert.equal(await quotes(), 2)
  assert.ok((await read()).startsWith(before))
  assert.equal(await js(`document.activeElement === document.querySelector('[contenteditable]')`), true)
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Z', modifiers: 4, commands: ['undo'] })
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Z', modifiers: 4 })
  await wait(.2)
  assert.equal(await read(), before)
  await select(); await click(continueButton)
  await select(); await click(continueButton)
  assert.equal(await quotes(), 2, '重复划选不增加相同引用')
  await click('[data-testid="switch-thread"]')
  assert.equal(await read(), '', '引用不能泄漏到另一个 thread')
  await click('[data-testid="switch-thread"]')
  assert.equal(await quotes(), 2)
  await click('[data-testid="switch-view"]')
  assert.equal(await quotes(), 2, '切换视图保留引用')
  await click('[data-slot="composer-send"]')
  const submitted = JSON.parse(await js(`document.querySelector('[data-testid="submitted"]').textContent`))
  assert.ok(JSON.stringify(submitted).includes('thread-quote-v1'))
  await click('[data-testid="fail-send"]')
  assert.equal(await quotes(), 2, '发送失败保留引用')
  await select()
  await js(`document.querySelector('.selection-toolbar button:first-child').focus()`)
  await pressKey('ArrowRight')
  assert.equal(await js(`document.activeElement.textContent`), '此处提问')
  await pressKey('Enter'); await wait(.2)
  assert.equal(await js(`document.activeElement.tagName`), 'TEXTAREA')
  await typeText('解释这段'); await wait(.2)
  await click('[data-testid="selection-source"]')
  assert.equal(await js(`document.querySelector('.sel-bubble textarea').value`), '解释这段')
  await pressKey('Escape'); await wait(.2)
  assert.equal(await js(`!!document.querySelector('.sel-bubble textarea')`), true, '有草稿时 Escape 不丢弃问题')
  await pressKey('Escape'); await wait(.2)
  await click('.sel-bubble textarea'); await pressKey('Enter'); await wait(.2)
  const fork = JSON.parse(await js(`document.querySelector('[data-testid="selection-fork"]').textContent`))
  assert.equal(fork.question, '解释这段')
  assert.equal(fork.selection.threadId, 'thread-a')
  assert.equal(await quotes(), 2, '新分支操作不修改当前草稿')
  // 选区贴近顶部时翻到下方。
  await js(`document.querySelector('.msg-list').style.cssText = 'position:fixed;top:2px;left:2px;margin:0'`)
  await select()
  assert.equal(await js(`(() => {const a=window.getSelection().getRangeAt(0).getBoundingClientRect(); const b=document.querySelector('.selection-toolbar').getBoundingClientRect(); return b.top >= a.bottom && b.left >= 0})()`), true)
  await pressKey('Escape'); await wait(.2)
  assert.equal(await js(`!!document.querySelector('.selection-toolbar')`), false)
  const lifecycleErrors = await js(`window.__quoteLifecycleErrors`)
  await js(`console.error = window.__quoteOriginalConsoleError`)
  assert.deepEqual(lifecycleErrors, [], '引用插入不得在 React 生命周期内 flushSync')
  cliLog('PASS 划选工具条：定位/翻转、Lexical 引用/撤销/去重、thread 隔离、视图切换、失败保留、分支弹窗/草稿保护')
}
