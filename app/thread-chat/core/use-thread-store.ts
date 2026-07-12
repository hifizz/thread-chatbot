/**
 * core/use-thread-store —— core 层唯一的 React 绑定文件。
 *
 * store 是「稳定对象 + 原地修改 + version 递增」模型，state 引用永远不变，
 * 因此快照取 version（数字）而非 state 本身：mutate → version++ → 订阅组件重渲，
 * 渲染时再从 store.getState() 读最新树。服务端快照同样取 version（首渲为 0），
 * 与客户端首渲一致，不会产生 hydration mismatch。
 */

import { useSyncExternalStore } from "react";
import type { ThreadStore } from "./store";

export function useThreadStore(store: ThreadStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}
