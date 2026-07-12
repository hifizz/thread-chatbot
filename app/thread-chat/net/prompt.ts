/**
 * net/prompt —— 把会话树状态编译成发给 /api/chat 的 messages（纯函数，无副作用）。
 *
 * 消息序：
 *   1. collectInherited：沿 lineage 向上继承的上文（映射为 user/assistant）。
 *   2. 分支代拟首问（kickoff）：围绕锚点让模型开讲——只进请求 payload，不进 store，
 *      每次请求都重建，分支的后续轮次同样带上，保证模型视角「有问才有答」。
 *   3. 当前会话已有消息（排除本次流式占位、error 消息、空正文的 assistant 消息）。
 *   4. 最后把通用/分支风格指令（system 段）折叠进「首条 user 消息」的前缀。
 *
 * 为什么不发 system 角色消息：/api/chat 普通模式 `system: undefined` 且不从 body 读 system，
 * 而 AI SDK v7 的 streamText 会拒绝 messages 里出现 system 角色
 * （AI_InvalidPromptError: System messages are not allowed... Use the instructions option instead，
 * 已在真实流式冒烟中复现）。路由禁止改动，故采用设计文档 B 节的兜底：把 system 段并进首条 user 消息前缀。
 *
 * 关于类型：这里自定义了轻量的 UIMessageLike，而不 `import type { UIMessage } from "ai"`。
 * 理由——请求体只是一段 JSON，字段校验发生在服务端的 convertToModelMessages；
 * 客户端只需构造出结构匹配的对象即可，自定义最小类型既能保持 demo「零外部 import」
 * 的风格，也避免把 ai 的 UIMessage 泛型（带 metadata/dataParts 等）拖进客户端类型面。
 */

import { collectInherited } from "../core/selectors";
import type { Thread, ThreadTreeState } from "../core/types";

/** 发给 /api/chat 的最小消息形状（结构匹配 ai 的 UIMessage，仅用纯文本 part）。
 *  不含 system 角色——风格指令折叠进首条 user 消息，见文件头说明。 */
export interface UIMessageLike {
  id: string;
  role: "user" | "assistant";
  parts: { type: "text"; text: string }[];
}

/** 通用 system 段：强制纯文本、禁 Markdown、不调用工具（保锚点/划选稳定） */
const GENERAL_SYSTEM =
  "请始终使用纯文本回答：不要使用任何 Markdown 语法（**、#、`、代码块、- 或 1. 列表、表格、链接标记），" +
  "用空行分隔段落。回答保持聚焦、适度精炼。不要调用任何工具，直接用文字回答。";

/** 分支追加段：说明分支语境 + 本分支讨论焦点 = 被划选的原文 */
function branchSegment(anchorText: string): string {
  return (
    "你在一个支持分支对话的应用中：用户阅读你此前的回答时，划选了其中一段文字，开启了当前分支。" +
    `本分支的讨论焦点是这段被划选的话：「${anchorText}」。` +
    "请围绕这个焦点结合上文展开，除非用户把话题引向别处。"
  );
}

/** 分支代拟首问：让模型对着锚点开讲（确定性函数，不落 store） */
function kickoffText(anchorText: string): string {
  return (
    `请围绕我划选的这段话展开讲解：「${anchorText}」。` +
    "先解释它本身的含义，再讲清楚它为什么重要或常见误区/延伸，控制在三段以内。"
  );
}

/** 一条领域消息是否应进入 payload（滤掉 error 与空正文 assistant） */
function includable(role: "user" | "assistant", text: string, status?: string): boolean {
  if (status === "error") return false;
  if (role === "assistant" && text.trim() === "") return false;
  return true;
}

/**
 * 组装本次请求的 messages。
 * @param excludeMsgId 本次流式回复的占位消息 id（当前 pending/streaming 的空 assistant），需排除
 */
export function buildRequestMessages(
  state: ThreadTreeState,
  thread: Thread,
  excludeMsgId: string,
): UIMessageLike[] {
  const isBranch = !!thread.anchorText && thread.anchorText.trim().length > 0;
  const messages: UIMessageLike[] = [];

  // 1. 继承的上文
  for (const m of collectInherited(state, thread)) {
    if (!includable(m.role, m.text, m.status)) continue;
    messages.push({ id: `inh-${m.id}`, role: m.role, parts: [{ type: "text", text: m.text }] });
  }

  // 2. 分支代拟首问（每次都重建，不进 store）
  if (isBranch) {
    messages.push({
      id: `kickoff-${thread.id}`,
      role: "user",
      parts: [{ type: "text", text: kickoffText(thread.anchorText as string) }],
    });
  }

  // 3. 当前会话已有消息（排除流式占位 / error / 空 assistant）
  for (const m of thread.messages) {
    if (m.id === excludeMsgId) continue;
    if (!includable(m.role, m.text, m.status)) continue;
    messages.push({ id: m.id, role: m.role, parts: [{ type: "text", text: m.text }] });
  }

  // 4. 把 system 段折叠进首条 user 消息前缀（streamText 不允许 system 角色，见文件头）
  const systemText = isBranch
    ? `${GENERAL_SYSTEM}\n\n${branchSegment(thread.anchorText as string)}`
    : GENERAL_SYSTEM;
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser) {
    const original = firstUser.parts[0]?.text ?? "";
    firstUser.parts = [{ type: "text", text: `${systemText}\n\n${original}` }];
  } else {
    // 兜底：极端情况下没有任何 user 消息，则用一条 user 消息承载指令
    messages.unshift({ id: `sys-${thread.id}`, role: "user", parts: [{ type: "text", text: systemText }] });
  }

  return messages;
}
