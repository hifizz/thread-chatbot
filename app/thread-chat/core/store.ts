/**
 * core/store —— 外部可变 store（zustand vanilla 风格，零依赖，纯 TS）。
 *
 * 模型：会话树对象身份稳定、原地修改；每次 mutate 后 version++ 并通知订阅者，
 * React 侧经 useSyncExternalStore 以 version 为快照触发重渲（见 use-thread-store.ts）。
 * 组件不允许直接改树，所有变更走这里的方法——这也是 demo 能通过
 * react-hooks/immutability 等规则的关键：mutation 全部收敛在非 React 代码里。
 */

import type { ArtifactSeed, Message, ThreadTreeState } from "./types";

export interface ForkInput {
  /** 在哪个会话里划选的 */
  sourceThreadId: string;
  /** 划选的是哪条消息 */
  sourceMsgId: string;
  /** 被划选的原文（同时决定新会话标题与脚注锚点） */
  anchorText: string;
}

export interface ForkResult {
  threadId: string;
  title: string;
}

export type ThreadStore = ReturnType<typeof createThreadStore>;

export function createThreadStore(seed: ThreadTreeState) {
  const state = seed;
  let version = 0;
  const listeners = new Set<() => void>();

  const notify = () => {
    version++;
    listeners.forEach((fn) => fn());
  };

  /** 活跃计数 + 最近访问（供 LRU 放置与 ⌘K「最近访问」chips 使用），不发通知 */
  const touchSilently = (id: string) => {
    const t = state.threads[id];
    if (!t) return;
    state.tick++;
    t.lastActive = state.tick;
    if (id !== "main") state.recents = [id, ...state.recents.filter((x) => x !== id)].slice(0, 6);
  };

  /** 登记一个 artifact（含 id 分配与 tab 顺序），不发通知 */
  const registerSilently = (sourceThreadId: string, seed_: ArtifactSeed): string => {
    const id = "a" + state.seq++;
    state.artifacts[id] = { id, sourceThreadId, ...seed_ };
    state.artifactOrder.push(id);
    return id;
  };

  /** 从尾部反向查找消息（流式目标通常是最新消息，反向查找更快） */
  const findMessageFromTail = (messages: Message[], msgId: string): Message | undefined => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].id === msgId) return messages[i];
    }
    return undefined;
  };

  return {
    getState: () => state,
    getVersion: () => version,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    /** 标记某会话「刚被用过」：打开、发消息、被切换到时都要调 */
    touch(id: string) {
      touchSilently(id);
      notify();
    },

    /** 从一条消息的划选文字上开出新分支；新分支消息为空，首条回复由 chat-controller 触发流式生成 */
    fork(input: ForkInput): ForkResult | null {
      const parent = state.threads[input.sourceThreadId];
      if (!parent) return null;
      const srcMsg = parent.messages.find((m) => m.id === input.sourceMsgId);
      if (!srcMsg) return null;

      state.footnoteCounter++;
      const id = "b" + state.seq++;
      const depth = parent.depth + 1;
      const title =
        input.anchorText.length > 13 ? input.anchorText.slice(0, 13) + "…" : input.anchorText;

      state.threads[id] = {
        id,
        parentId: input.sourceThreadId,
        depth,
        title,
        anchorText: input.anchorText,
        forkFromMsgId: input.sourceMsgId,
        footnote: state.footnoteCounter,
        children: [],
        messages: [],
        lastActive: 0,
      };
      parent.children.push(id);
      srcMsg.forks.push({ text: input.anchorText, num: state.footnoteCounter, threadId: id, depth });

      notify();
      return { threadId: id, title };
    },

    /** 追加一条用户消息；返回消息 id，会话不存在时返回 null */
    appendUserMessage(threadId: string, text: string): string | null {
      const t = state.threads[threadId];
      if (!t) return null;
      const id = "m" + state.seq++;
      t.messages.push({ id, role: "user", text, forks: [] });
      touchSilently(threadId);
      notify();
      return id;
    },

    /** 新建一条 pending 的空 assistant 消息（流式回复的占位），返回消息 id */
    beginAssistantMessage(threadId: string): string | null {
      const t = state.threads[threadId];
      if (!t) return null;
      const id = "m" + state.seq++;
      t.messages.push({ id, role: "assistant", text: "", forks: [], status: "pending" });
      notify();
      return id;
    },

    /** 给流式中的 assistant 消息追加一段文本增量 */
    appendAssistantDelta(threadId: string, msgId: string, delta: string): void {
      const t = state.threads[threadId];
      if (!t) return;
      const msg = findMessageFromTail(t.messages, msgId);
      if (!msg) return;
      msg.text += delta;
      msg.status = "streaming";
      notify();
    },

    /** 流式结束：标记消息完成 */
    finishAssistantMessage(threadId: string, msgId: string): void {
      const t = state.threads[threadId];
      if (!t) return;
      const msg = findMessageFromTail(t.messages, msgId);
      if (!msg) return;
      msg.status = "done";
      touchSilently(threadId);
      notify();
    },

    /** 流式失败：标记错误（已收到的文本保留） */
    failAssistantMessage(threadId: string, msgId: string, message: string): void {
      const t = state.threads[threadId];
      if (!t) return;
      const msg = findMessageFromTail(t.messages, msgId);
      if (!msg) return;
      msg.status = "error";
      msg.error = message;
      notify();
    },

    /** 重试前重置消息：清空正文与错误，回到 pending，复用同一 msgId */
    resetAssistantMessage(threadId: string, msgId: string): void {
      const t = state.threads[threadId];
      if (!t) return;
      const msg = findMessageFromTail(t.messages, msgId);
      if (!msg) return;
      msg.text = "";
      msg.status = "pending";
      msg.error = undefined;
      notify();
    },

    /** 单独登记一个 artifact（fork 之外的入口，预留） */
    registerArtifact(sourceThreadId: string, seed_: ArtifactSeed): string {
      const id = registerSilently(sourceThreadId, seed_);
      notify();
      return id;
    },
  };
}
