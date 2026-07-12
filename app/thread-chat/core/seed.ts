/**
 * core/seed —— 空种子状态：只有一条空主线，无任何写死数据。
 * 取代原 demo 的 data.ts（canned 数据），供 thread-chat-demo.tsx 初始化 store 使用。
 */

import type { ThreadTreeState } from "./types"

export function emptySeedState(): ThreadTreeState {
  return {
    threads: {
      main: {
        id: "main",
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        messages: [],
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
