import assert from 'node:assert/strict'
import { applyDocumentEdits } from '../../lib/thread-chat/domain/documents/edit.ts'
const input = '# 计划\n- [ ] TODO6\n方案：旧方案\n\n其他任务保持不变'
assert.deepEqual(applyDocumentEdits(input, [
  { oldText: '- [ ] TODO6', newText: '- [x] TODO6' },
  { oldText: '方案：旧方案', newText: '方案：新方案' },
]), { ok: true, content: input.replace('- [ ] TODO6', '- [x] TODO6').replace('方案：旧方案', '方案：新方案'), changed: true })
assert.equal(applyDocumentEdits(input, [{ oldText: '已被删除', newText: '恢复' }]).code, 'SOURCE_NOT_FOUND')
assert.equal(applyDocumentEdits('重复重复', [{ oldText: '重复', newText: '新' }]).code, 'SOURCE_AMBIGUOUS')
assert.equal(applyDocumentEdits('aaaa', [{ oldText: 'aaa', newText: '新' }]).code, 'SOURCE_AMBIGUOUS')
assert.equal(applyDocumentEdits(input, [{ oldText: 'TODO6', newText: '任务' }, { oldText: '- [ ] TODO6', newText: '删除' }]).code, 'OVERLAPPING_EDITS')
assert.equal(applyDocumentEdits(input, [{ oldText: '', newText: '追加' }]).code, 'INVALID_EDIT')
assert.equal(applyDocumentEdits(input, [{ oldText: input, newText: '' }]).code, 'INVALID_EDIT')
assert.equal(applyDocumentEdits(input, [{ oldText: 'TODO6', newText: 'x'.repeat(64000) }]).code, 'INVALID_EDIT')
assert.equal(applyDocumentEdits(input, [{ oldText: 'TODO6', newText: 'TODO6' }]).changed, false)
assert.equal(applyDocumentEdits(input, [{ oldText: '方案：旧方案', newText: '' }]).content, input.replace('方案：旧方案', ''))
assert.equal(applyDocumentEdits(input, [{ oldText: 'TODO6', newText: 'TODO6\n新增段落' }]).content, input.replace('TODO6', 'TODO6\n新增段落'))
assert.equal(applyDocumentEdits(input, [{ oldText: 'TODO6', newText: '已完成' }, { oldText: '缺失', newText: '内容' }]).ok, false)
console.log('Markdown 多处原子修改、删除、重复、重叠、大小及 no-op：12 项通过')
