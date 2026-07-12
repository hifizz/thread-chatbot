// thread-chat 分支对话页（app/thread-chat）的服务端 system 提示模板常量。

/** 通用纯文本风格段：该模式渲染层依赖 indexOf 锚点匹配，必须压制 Markdown 记号 */
export const THREAD_CHAT_PLAIN_TEXT_SYSTEM =
  "请始终使用纯文本回答：不要使用任何 Markdown 语法（**、#、`、代码块、- 或 1. 列表、表格、链接标记），" +
  "用空行分隔段落。回答保持聚焦、适度精炼。"

/** 分支焦点段的前半：后接被划选的锚点原文（见 lib/chat/thread-chat-prompt.ts） */
export const THREAD_CHAT_BRANCH_PREFIX =
  "你在一个支持分支对话的应用中：用户阅读你此前的回答时，划选了其中一段文字，开启了当前分支。" +
  "本分支的讨论焦点是这段被划选的话："

/** 分支焦点段的后半：跟在锚点原文之后 */
export const THREAD_CHAT_BRANCH_SUFFIX =
  "请围绕这个焦点结合上文展开，除非用户把话题引向别处。"
