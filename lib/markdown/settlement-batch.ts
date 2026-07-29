/**
 * 聚合同一份 Markdown source 内所有异步代码块的 DOM 结算状态。
 *
 * 代码块先 register，Markdown 容器在本次 commit 后 seal；只有 seal 且所有
 * registration 都 settle 后，batch 才对外变为 settled。registration 与 seal
 * 都是幂等的，便于承受 React Strict Mode 的 effect 重放。
 */

export interface MarkdownSettlementSnapshot {
  revision: number
  settled: boolean
}

export interface MarkdownSettlementRegistration {
  settle(): void
  cancel(): void
}

export interface MarkdownSettlementBatch {
  readonly revision: number
  getSnapshot(): MarkdownSettlementSnapshot
  register(): MarkdownSettlementRegistration
  seal(): void
  subscribe(listener: () => void): () => void
}

export function createMarkdownSettlementBatch(
  revision: number
): MarkdownSettlementBatch {
  let pending = 0
  let sealed = false
  let settled = false
  const listeners = new Set<() => void>()
  let snapshot: MarkdownSettlementSnapshot = { revision, settled: false }

  const emit = () => listeners.forEach((listener) => listener())

  const commitSettled = () => {
    if (!sealed || pending !== 0 || settled) return
    settled = true
    snapshot = { revision, settled: true }
    emit()
  }

  return {
    revision,
    getSnapshot: () => snapshot,
    register() {
      let active = true
      let registrationSettled = false

      pending += 1
      if (settled) {
        settled = false
        snapshot = { revision, settled: false }
        emit()
      }

      return {
        settle() {
          if (!active || registrationSettled) return
          registrationSettled = true
          pending -= 1
          commitSettled()
        },
        cancel() {
          if (!active) return
          active = false
          if (!registrationSettled) pending -= 1
          // cleanup 不是一次成功 commit；尤其整棵 Markdown 卸载时不能因此发 settled。
          // 若同 batch 仍有其它活跃块，最后一个真实 settle 会按剩余 pending 正常结算。
        },
      }
    },
    seal() {
      if (sealed) return
      sealed = true
      commitSettled()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * 同一 source/status 得到稳定的浏览器可序列化 revision。batch 的真实隔离依赖
 * 对象身份；该数字只用于 DOM 诊断与 settled 回调，不作为竞态判定依据。
 */
export function markdownSettlementRevision(
  source: string,
  streaming: boolean
): number {
  let hash = streaming ? 0x811c9dc4 : 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
