// thread-chat 分支对话页（app/thread-chat）的常量：
// 服务端 system 提示模板 + 分支树持久化（DB / localStorage）相关常量。

/**
 * 通用风格段：鼓励深入、结构化的回答。
 * 锚点已改由渲染后的 Markdown DOM 上模糊恢复定位（text-anchor），与纯文本彻底解耦，
 * 故不再压制 Markdown——放开让模型充分发挥。
 */
export const THREAD_CHAT_SYSTEM =
  "你是一位乐于深入讲解的助手。回答要结构清晰、有层次、尽量讲透：" +
  "善用 Markdown 组织内容——用标题分段、用有序 / 无序列表罗列要点、" +
  "用代码块承载代码或公式、用表格对比、用**加粗**突出关键概念。" +
  "在有价值处展开细节、举例、说明常见误区或延伸，不必刻意压缩篇幅。"

/** 分支焦点段的前半：后接被划选的锚点原文（见 lib/chat/thread-chat-prompt.ts） */
export const THREAD_CHAT_BRANCH_PREFIX =
  "你在一个支持分支对话的应用中：用户阅读你此前的回答时，划选了其中一段文字，开启了当前分支。" +
  "本分支的讨论焦点是这段被划选的话："

/** 分支焦点段的后半：跟在锚点原文之后 */
export const THREAD_CHAT_BRANCH_SUFFIX =
  "请围绕这个焦点结合上文展开，除非用户把话题引向别处。" +
  "用户问题里的指代（如「这」「它」「这段话」）默认指向这段被划选的话，而不是上文的其他内容。"

/**
 * 继承段上下文字符总预算（openspec: add-bubble-composer D8）：
 * buildRequestBody 组继承段时从最新往回累计正文字符，超预算即以完整消息为单位
 * 丢弃更旧的部分（最少保 1 条），深树请求不再上下文爆炸。当前会话消息不受此限。
 */
export const INHERITED_CHAR_BUDGET = 6000

/**
 * 异步分支标题（openspec: add-bubble-composer D7）的生成长度上限（字符）：
 * 提示词要求 4–8 字，服务端对超长输出按此截断兜底。
 */
export const BRANCH_TITLE_GEN_MAX_LEN = 8

/* ---------------- 分支树持久化（DB + localStorage） ---------------- */

/** localStorage：裸路径 /thread-chat 的跳转目标——最近打开的一棵树的 treeId */
export const LAST_TREE_ID_KEY = "thread-chat:last-tree-id"

/** localStorage：每棵树的工作台状态（列槽/列宽/列数/放置策略/视图），按 treeId 分键 */
export const TREE_UI_KEY_PREFIX = "thread-chat:ui:"

/** store version 变化后的整树存库防抖（毫秒）：流式高频跳变合并为结束后一次 PUT */
export const TREE_SAVE_DEBOUNCE_MS = 1500

/** 工作台状态写 localStorage 的轻防抖（毫秒，纯本地写很便宜） */
export const UI_SAVE_DEBOUNCE_MS = 300

/** 派生树标题：取 main 首条 user 消息的前多少个字符 */
export const TREE_TITLE_MAX_LEN = 20

/** 用户自定义标题（重命名，写 custom_title 列）的最大长度：trim 后超过即 400 */
export const CUSTOM_TITLE_MAX_LEN = 60

/** 无法派生标题（主线还没有 user 消息）时的兜底标题 */
export const TREE_TITLE_FALLBACK = "未命名对话"

/* ---------------- 弹层动效 ---------------- */

/**
 * 弹层（⌘K 会话树 / ⌘⇧K 对话列表 / 列锚定小面板）关闭动画后的卸载延时（毫秒）。
 * 要比 thread-chat.css 里 .swx 的 150ms 退场过渡略长：壳层先置 closing 播放退场，
 * 到点再真正卸载组件（Dialog 面板由 Base UI 在过渡结束时先行卸掉 Popup，这里只是兜底）。
 */
export const POPUP_EXIT_MS = 200
