/**
 * Markdown content-settled 聚合器的纯状态机测试：
 *   node --experimental-strip-types e2e/thread-chat/markdown-settlement.test.mjs
 */
import {
  createMarkdownSettlementBatch,
  markdownSettlementRevision,
} from "../../lib/markdown/settlement-batch.ts"

let failed = 0
const ok = (label, condition) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`)
  if (!condition) failed = 1
}

{
  const batch = createMarkdownSettlementBatch(1)
  let notifications = 0
  batch.subscribe(() => {
    notifications += 1
  })
  batch.seal()
  batch.seal()
  ok("没有代码块时 seal 后结算", batch.getSnapshot().settled)
  ok("重复 seal 不重复通知", notifications === 1)
}

{
  const batch = createMarkdownSettlementBatch(2)
  const first = batch.register()
  const second = batch.register()
  const third = batch.register()
  let notifications = 0
  batch.subscribe(() => {
    notifications += 1
  })
  batch.seal()
  third.settle()
  first.settle()
  ok("多代码块乱序完成时不会提前结算", !batch.getSnapshot().settled)
  second.settle()
  second.settle()
  ok("最后一个代码块完成后结算", batch.getSnapshot().settled)
  ok("重复 settle 不重复通知", notifications === 1)
}

{
  const batch = createMarkdownSettlementBatch(3)
  const highlighted = batch.register()
  const fallback = batch.register()
  batch.seal()
  fallback.settle()
  highlighted.settle()
  ok("plaintext/失败 fallback 与高亮块使用同一结算语义", batch.getSnapshot().settled)
}

{
  const oldBatch = createMarkdownSettlementBatch(4)
  const currentBatch = createMarkdownSettlementBatch(5)
  const oldBlock = oldBatch.register()
  const currentBlock = currentBatch.register()
  let currentNotifications = 0
  currentBatch.subscribe(() => {
    currentNotifications += 1
  })
  oldBatch.seal()
  currentBatch.seal()
  oldBlock.settle()
  ok("旧 source 晚到不会结算当前 batch", currentNotifications === 0)
  currentBlock.settle()
  ok("当前 source 独立结算", currentNotifications === 1)
}

{
  const batch = createMarkdownSettlementBatch(6)
  const strictFirst = batch.register()
  strictFirst.cancel()
  const strictReplay = batch.register()
  batch.seal()
  strictReplay.settle()
  ok("Strict Mode 注册 cleanup/replay 后仍可结算", batch.getSnapshot().settled)
}

{
  const batch = createMarkdownSettlementBatch(7)
  const block = batch.register()
  let notifications = 0
  batch.subscribe(() => {
    notifications += 1
  })
  batch.seal()
  block.cancel()
  ok("组件卸载 cleanup 不伪装成成功结算", notifications === 0)
}

ok(
  "相同 source/status 的诊断 revision 稳定",
  markdownSettlementRevision("```ts\\nconst n = 1\\n```", false) ===
    markdownSettlementRevision("```ts\\nconst n = 1\\n```", false)
)
ok(
  "streaming 与稳定态使用不同诊断 revision",
  markdownSettlementRevision("same", true) !==
    markdownSettlementRevision("same", false)
)

process.exit(failed)
