"use client"

import { useSyncExternalStore } from "react"

import type {
  CanonicalSubscriptionKey,
  NormalizedConversationStore,
} from "./normalized-conversation-store"

export function useCanonicalSubscription(
  store: NormalizedConversationStore,
  key: CanonicalSubscriptionKey
): number {
  return useSyncExternalStore(
    (notify) => store.subscribe(key, notify),
    () => store.snapshotForKey(key),
    () => 0
  )
}

export function useCanonicalSelector<T>(
  store: NormalizedConversationStore,
  key: CanonicalSubscriptionKey,
  selector: () => T
): T {
  useCanonicalSubscription(store, key)
  // selector 的稳定缓存由 selector 层自身维护；key 更新只负责触发本组件重新读取。
  return selector()
}
