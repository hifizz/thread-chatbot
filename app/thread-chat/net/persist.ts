/**
 * net/persist —— 分支树持久化的客户端一侧：加载 / 防抖存盘的网络调用、
 * treeId 记忆、加载期 sanitize、每棵树的工作台状态（localStorage）。
 *
 * 职责边界：
 * · 对话数据（ThreadTreeState）走 DB（/api/branch-trees/{treeId}），整树 JSON 存取；
 * · 设备本地 UI 态（列槽/列宽/列数/放置策略/视图）按 treeId 分键走 localStorage——
 *   列宽与视口强相关、丢了无伤，不值得进 DB；
 * · localStorage / fetch 只允许在客户端（effect 或事件回调）里调用本模块的函数。
 *
 * 为什么需要 sanitizeLoadedState：防抖存盘可能恰好在流式中途落盘，而 AbortController
 * 不跨页面存活——重载后没有任何东西会把 pending/streaming 的 assistant 消息推进到终态，
 * 不收敛就是永远转圈的僵尸气泡。收敛规则与现有交互语义一致：有正文置 done（同停止按钮
 * ——保留已收文本完成）；空占位删除（同重试——用户可重新发问）。
 */

import {
  LAST_TREE_ID_KEY,
  TREE_TITLE_FALLBACK,
  TREE_TITLE_MAX_LEN,
  TREE_UI_KEY_PREFIX,
} from "@/constants/thread-chat"
import { isValidTreeId } from "@/lib/chat/tree-id"
import type { Message, Thread, ThreadTreeState } from "../core/types"
import type { PlacementMode, Slot } from "../orchestration/placement"

export { isValidTreeId }

/* ---------------- 「最近一棵」treeId 记忆（裸路径 /thread-chat 的跳转目标） ---------------- */

export function rememberTreeId(id: string): void {
  try {
    localStorage.setItem(LAST_TREE_ID_KEY, id)
  } catch {
    /* localStorage 不可用（隐私模式等）：记忆失败无伤，裸路径会开新树 */
  }
}

export function getLastTreeId(): string | null {
  try {
    const id = localStorage.getItem(LAST_TREE_ID_KEY)
    return id && isValidTreeId(id) ? id : null
  } catch {
    return null
  }
}

/* ---------------- 整树加载 / 存盘（DB） ---------------- */

/** GET 整树：未保存过返回 null（正常首访路径）；请求失败也返回 null 并 console.warn（降级空树） */
export async function loadTree(id: string): Promise<ThreadTreeState | null> {
  try {
    const res = await fetch(`/api/branch-trees/${id}`)
    if (!res.ok) throw new Error(`GET /api/branch-trees ${res.status}`)
    const data = (await res.json()) as { state: ThreadTreeState | null }
    return data.state
  } catch (err) {
    console.warn(
      "[thread-chat] 加载分支树失败，以空树降级启动（本次不恢复历史）：",
      err
    )
    return null
  }
}

/** PUT 整树 upsert：失败只 console.warn 不抛——持久化失败不能打断对话 */
export async function saveTree(
  id: string,
  state: ThreadTreeState,
  title?: string
): Promise<void> {
  try {
    const res = await fetch(`/api/branch-trees/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, title }),
    })
    if (!res.ok) throw new Error(`PUT /api/branch-trees ${res.status}`)
  } catch (err) {
    console.warn("[thread-chat] 分支树存盘失败（下次变更会再试）：", err)
  }
}

/** 派生树标题：main 首条 user 消息前 TREE_TITLE_MAX_LEN 字，无则兜底文案 */
export function deriveTreeTitle(state: ThreadTreeState): string {
  const firstUser = state.threads.main?.messages.find((m) => m.role === "user")
  const text = firstUser?.text.trim()
  return text ? text.slice(0, TREE_TITLE_MAX_LEN) : TREE_TITLE_FALLBACK
}

/* ---------------- 加载期 sanitize：非终态 assistant 消息收敛 ---------------- */

/** 纯函数：pending/streaming 的 assistant 残留——有正文 → done；空占位 → 删除。无残留时原样返回 */
export function sanitizeLoadedState(state: ThreadTreeState): ThreadTreeState {
  let changed = false
  const threads: Record<string, Thread> = {}
  for (const [id, t] of Object.entries(state.threads)) {
    let threadChanged = false
    const messages: Message[] = []
    for (const m of t.messages) {
      if (
        m.role === "assistant" &&
        (m.status === "pending" || m.status === "streaming")
      ) {
        threadChanged = true
        if (m.text.trim() !== "") messages.push({ ...m, status: "done" })
        // 空占位：直接不放入（删除）
      } else {
        messages.push(m)
      }
    }
    threads[id] = threadChanged ? { ...t, messages } : t
    changed ||= threadChanged
  }
  return changed ? { ...state, threads } : state
}

/* ---------------- 每棵树的工作台状态（localStorage，按 treeId 分键） ---------------- */

/** 视图形态：列（并排深读）| 画布（纵览全树）。与 thread-chat-demo 共用 */
export type ViewMode = "columns" | "canvas"

/** 一棵树的工作台状态：随树恢复的「桌面摆法」，不进 DB 的对话数据 */
export interface TreeUiState {
  /** 打开的分支列及折叠态（不含主线） */
  slots: Slot[]
  /** 显式列宽（threadId → px），无条目的列自动均分 */
  widths: Record<string, number>
  /** 列数覆盖（null = 自适应） */
  forceCols: number | null
  /** 列满放置策略 */
  mode: PlacementMode
  /** 列 / 画布视图 */
  viewMode: ViewMode
}

const uiKeyOf = (treeId: string) => `${TREE_UI_KEY_PREFIX}${treeId}`

/** 存工作台状态（调用方负责防抖）；写失败无伤，静默 */
export function saveUiState(treeId: string, ui: TreeUiState): void {
  try {
    localStorage.setItem(uiKeyOf(treeId), JSON.stringify(ui))
  } catch {
    /* 忽略：布局记忆丢失无伤，重摆即可 */
  }
}

/**
 * 读工作台状态并对照加载回来的树数据校验：
 * slots / widths 里引用的 threadId 必须仍存在（失配过滤）；字段形状不对整体作废。
 * 返回 null = 无可用记忆，回默认布局（只开主线）。
 */
export function loadUiState(
  treeId: string,
  state: ThreadTreeState
): TreeUiState | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(uiKeyOf(treeId))
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TreeUiState>
    const slots: Slot[] = Array.isArray(parsed.slots)
      ? parsed.slots
          .filter(
            (s): s is Slot =>
              !!s &&
              typeof s.id === "string" &&
              typeof s.folded === "boolean" &&
              s.id !== "main" &&
              state.threads[s.id] !== undefined
          )
          .map((s) => ({ id: s.id, folded: s.folded }))
      : []
    const widths: Record<string, number> = {}
    if (parsed.widths && typeof parsed.widths === "object") {
      for (const [id, w] of Object.entries(parsed.widths)) {
        if (typeof w === "number" && Number.isFinite(w) && state.threads[id])
          widths[id] = w
      }
    }
    return {
      slots,
      widths,
      forceCols: typeof parsed.forceCols === "number" ? parsed.forceCols : null,
      mode: parsed.mode === "fold" ? "fold" : "replace",
      viewMode: parsed.viewMode === "canvas" ? "canvas" : "columns",
    }
  } catch {
    return null // 记忆损坏：整体作废，回默认布局
  }
}
