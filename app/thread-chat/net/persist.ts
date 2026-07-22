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
 * 不收敛就是永远转圈的僵尸气泡。正文或有效 Artifact 均视为可恢复输出；空占位删除，
 * 同时过滤坏消息引用与无消息归属的孤儿 registry/order 项。
 */

import {
  LAST_TREE_ID_KEY,
  TREE_TITLE_FALLBACK,
  TREE_TITLE_MAX_LEN,
  TREE_UI_KEY_PREFIX,
} from "@/constants/thread-chat"
import { isValidTreeId } from "@/lib/chat/tree-id"
import { fetchWithAuth } from "@/lib/auth/session-recovery"
import type { ThreadTreeState } from "../core/types"
import type { PlacementMode, Slot } from "../orchestration/placement"
import { withoutTransientGenerationState } from "./transient-state"
export { sanitizeLoadedState } from "./sanitize-loaded-state"

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

/** loadTree 的返回：state = 整树（未保存过为 null）；customTitle = 用户重命名过的标题（未改过为 null） */
export interface LoadedTree {
  state: ThreadTreeState | null
  customTitle: string | null
}

/** GET 整树：未保存过 state 为 null（正常首访路径）；请求失败也降级为空并 console.warn（空树启动） */
export async function loadTree(id: string): Promise<LoadedTree> {
  try {
    const res = await fetchWithAuth(`/api/branch-trees/${id}`)
    if (!res.ok) throw new Error(`GET /api/branch-trees ${res.status}`)
    const data = (await res.json()) as LoadedTree
    return { state: data.state, customTitle: data.customTitle ?? null }
  } catch (err) {
    console.warn(
      "[thread-chat] 加载分支树失败，以空树降级启动（本次不恢复历史）：",
      err
    )
    return { state: null, customTitle: null }
  }
}

/** PUT 整树 upsert：失败只 console.warn 不抛——持久化失败不能打断对话 */
/* 每棵树一条客户端写链：saveTree / deleteTree 串行执行（codex review 两条 P2 的修复）——
   ① 慢的旧快照 PUT 不会后到覆盖新快照（同树写操作严格按入队序落库）；
   ② 删除总排在已入队/在飞的存盘之后，配合壳层「删除前置抑制位」堵死 DB 行复活竞态。
   链上任务失败不断链（下一个任务照常执行）；链清空后从 Map 摘除防泄漏。 */
const writeChains = new Map<string, Promise<void>>()
function enqueueTreeWrite<T>(id: string, task: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(id) ?? Promise.resolve()
  const run = prev.then(task, task)
  const settled = run.then(
    () => undefined,
    () => undefined
  )
  writeChains.set(id, settled)
  void settled.then(() => {
    if (writeChains.get(id) === settled) writeChains.delete(id)
  })
  return run
}

export async function saveTree(
  id: string,
  state: ThreadTreeState,
  title?: string
): Promise<void> {
  return enqueueTreeWrite(id, async () => {
    try {
      const res = await fetchWithAuth(`/api/branch-trees/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state: withoutTransientGenerationState(state),
          title,
        }),
      })
      if (!res.ok) throw new Error(`PUT /api/branch-trees ${res.status}`)
    } catch (err) {
      console.warn("[thread-chat] 分支树存盘失败（下次变更会再试）：", err)
    }
  })
}

/* ---------------- 树列表 / 重命名 / 删除（会话列表 UI，openspec: add-tree-list-ui） ---------------- */

/** GET /api/branch-trees 的条目形状（轻量列表，无 state） */
export interface TreeListItem {
  id: string
  /** 展示标题：服务端已做 coalesce(custom_title, title, 兜底) */
  title: string
  /** ISO 时间字符串（JSON 序列化后的 timestamp） */
  updatedAt: string
  threadCount: number
}

/** GET 树列表：失败返回空数组并 console.warn（弹层显示空态，不打断页面） */
export async function listTrees(): Promise<TreeListItem[]> {
  try {
    const res = await fetchWithAuth("/api/branch-trees")
    if (!res.ok) throw new Error(`GET /api/branch-trees ${res.status}`)
    const data = (await res.json()) as { trees: TreeListItem[] }
    return data.trees
  } catch (err) {
    console.warn("[thread-chat] 拉取树列表失败：", err)
    return []
  }
}

/** PATCH 重命名（只写 custom_title）：失败抛错——调用方做乐观更新回滚 + toast */
export async function renameTree(id: string, title: string): Promise<void> {
  const res = await fetchWithAuth(`/api/branch-trees/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`PATCH /api/branch-trees ${res.status}`)
}

/** DELETE 树（幂等）：失败抛错——调用方保留条目 + toast */
export async function deleteTree(id: string): Promise<void> {
  return enqueueTreeWrite(id, async () => {
    const res = await fetchWithAuth(`/api/branch-trees/${id}`, {
      method: "DELETE",
    })
    if (!res.ok) throw new Error(`DELETE /api/branch-trees ${res.status}`)
  })
}

/** 删除某棵树后的本地善后（design D4）：清工作台记忆；「最近一棵」若指向它则清除 */
export function cleanupAfterTreeDelete(id: string): void {
  try {
    localStorage.removeItem(uiKeyOf(id))
    if (localStorage.getItem(LAST_TREE_ID_KEY) === id)
      localStorage.removeItem(LAST_TREE_ID_KEY)
  } catch {
    /* localStorage 不可用：孤儿键无伤，忽略 */
  }
}

/** 派生树标题：main 首条 user 消息前 TREE_TITLE_MAX_LEN 字，无则兜底文案 */
export function deriveTreeTitle(state: ThreadTreeState): string {
  const firstUser = state.threads.main?.messages.find((m) => m.role === "user")
  const text = firstUser?.text.trim()
  return text ? text.slice(0, TREE_TITLE_MAX_LEN) : TREE_TITLE_FALLBACK
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
