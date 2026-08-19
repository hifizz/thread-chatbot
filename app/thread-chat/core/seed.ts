/**
 * core/seed —— 空种子状态：只有一条空主线，无任何写死数据。
 * 取代原 demo 的 data.ts（canned 数据），供 thread-chat-demo.tsx 初始化 store 使用。
 */

import type { ThreadTreeState } from "./types"
import { DEFAULT_THREAD_CHAT_MODEL_ID } from "@/constants/model"

export function emptySeedState(): ThreadTreeState {
  return {
    schemaVersion: 2,
    threads: {
      main: {
        id: "main",
        modelId: DEFAULT_THREAD_CHAT_MODEL_ID,
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        messages: [],
        activeLeafMessageId: null,
        lastActive: 1,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: [],
    footnoteCounter: 0,
    seq: 1,
    tick: 1,
  }
}
