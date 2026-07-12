/**
 * net/chat-controller —— 会话的「发送 / 分支首答 / 重试 / 中止」统一入口。
 *
 * 阶段一：fakeStream 用本地 setInterval 模拟逐片吐字，验证消息状态机
 * （pending → streaming → done/error）与 UI（打字指示 / 光标 / 错误条）先跑通。
 * 阶段二将把 fakeStream 替换为真实 /api/chat SSE 消费，这里导出的公共 API
 * （send / startBranch / retry / abort / abortAll）保持不变。
 */

import type { ThreadStore } from "../core/store";

const FAKE_REPLY =
  "这是阶段一的本地模拟流式回复，用于验证消息状态机与 UI。真实 MiniMax 接入在阶段二完成。";
const FAKE_STEP_MS = 30;
const FAKE_CHUNK_MIN = 2;
const FAKE_CHUNK_MAX = 3;

export type ChatController = ReturnType<typeof createChatController>;

export function createChatController(store: ThreadStore) {
  /** 每个会话同一时间只允许一路在飞的流式请求；值为可调用的中止函数 */
  const inflight = new Map<string, () => void>();

  /** 用本地定时器模拟逐片吐字，结束后 finish 并清理 inflight（阶段二替换为真实 SSE 消费） */
  function fakeStream(threadId: string, msgId: string) {
    let pos = 0;
    const timer = setInterval(() => {
      const step = Math.floor(Math.random() * (FAKE_CHUNK_MAX - FAKE_CHUNK_MIN + 1)) + FAKE_CHUNK_MIN;
      const delta = FAKE_REPLY.slice(pos, pos + step);
      pos += step;
      if (delta) store.appendAssistantDelta(threadId, msgId, delta);
      if (pos >= FAKE_REPLY.length) {
        clearInterval(timer);
        inflight.delete(threadId);
        store.finishAssistantMessage(threadId, msgId);
      }
    }, FAKE_STEP_MS);
    inflight.set(threadId, () => clearInterval(timer));
  }

  return {
    /** 在会话里发一条用户消息并触发流式回复；同会话已有在飞请求时直接忽略 */
    send(threadId: string, text: string): void {
      if (inflight.has(threadId)) return;
      if (!store.appendUserMessage(threadId, text)) return;
      const msgId = store.beginAssistantMessage(threadId);
      if (!msgId) return;
      fakeStream(threadId, msgId);
    },

    /** 分支首答：不追加用户消息，直接触发新分支的第一条流式回复 */
    startBranch(threadId: string): void {
      if (inflight.has(threadId)) return;
      const msgId = store.beginAssistantMessage(threadId);
      if (!msgId) return;
      fakeStream(threadId, msgId);
    },

    /** 重试：复位同一条消息（清空正文与错误、回到 pending），重新触发流式 */
    retry(threadId: string, msgId: string): void {
      if (inflight.has(threadId)) return;
      store.resetAssistantMessage(threadId, msgId);
      fakeStream(threadId, msgId);
    },

    /** 中止某会话在飞的流式请求（已收到的文本保留在消息上） */
    abort(threadId: string): void {
      const stop = inflight.get(threadId);
      if (!stop) return;
      stop();
      inflight.delete(threadId);
    },

    /** 中止所有会话在飞的流式请求（壳层卸载时调用） */
    abortAll(): void {
      inflight.forEach((stop) => stop());
      inflight.clear();
    },
  };
}
