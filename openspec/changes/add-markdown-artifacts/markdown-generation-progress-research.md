# Markdown Artifact 生成进度：问题、证据与结论

日期：2026-07-22
范围：ThreadChat 的 `createMarkdownArtifact` 生成链路

## 1. 用户可见问题

用户要求生成 Markdown 后，界面先出现一个没有正文的闪烁光标，约 20 秒后 Markdown Artifact 卡片才突然出现；随后模型又逐行输出“已生成 Markdown 文档、文档包含……”等重复说明。

这个现象包含三个独立问题：

1. 工具参数生成期间没有进度反馈。
2. 空白文本 delta 被当成可见正文，产生裸 caret。
3. Artifact 已经完成后，模型 loop 又进入下一步生成重复 recap。

## 2. 项目代码证据（修改前基线）

### 2.1 UI stream 丢弃了工具输入进度

`app/thread-chat/net/ui-stream.ts` 原先只处理：

- `text-delta`
- `error`
- `finish`
- 完整的 `tool-input-available(createMarkdownArtifact)`

`tool-input-start` 和 `tool-input-delta` 均进入 default 分支被静默跳过。因此模型虽然在持续生成 `title/content` 参数，客户端直到完整参数通过校验后才知道有 Artifact。

### 2.2 完整 Markdown 被放在一个长工具参数中

`lib/chat/markdown-artifact.ts` 的工具输入包含 `title` 和最多 64,000 字符的 `content`。模型需要先把整份 Markdown 作为 JSON 字符串生成完，服务端才能发送完整、已校验的 `tool-input-available`。

因此约 20 秒空窗主要不是工具 `execute` 慢，而是整份文档正在以工具参数形式生成，但增量事件未被 UI 消费。

### 2.3 空白 delta 会触发光标

`app/thread-chat/chat/chat-view.tsx` 与 `app/thread-chat/orchestration/canvas-node.tsx` 原先使用 `msg.text` 的 truthy 值决定是否渲染正文气泡。单个空格或换行在 JavaScript 中是 truthy，但 Markdown 渲染后没有可见内容，于是只剩 `.caret`。

controller 原先也按 `delta.length` 统计有效正文，使纯空白响应可能被错误判为成功。

### 2.4 服务端允许第二个模型 step

`app/api/chat/route.ts` 原先仅用 `isStepCount(5)` 限制普通请求。Markdown 工具执行返回 `{ created: true }` 后，AI SDK 可以继续第二步模型生成；模型据此输出“已生成、包含以下章节”等 recap。Artifact 卡片先出现、说明文字后流式出现，正是“工具 step → 第二个文本 step”的顺序。

## 3. AI SDK v7 本地证据

本项目安装 `ai@7`。以下证据来自仓库内 `node_modules/ai`，与当前实际版本一致：

- `node_modules/ai/src/ui-message-stream/ui-message-chunks.ts` 定义 `tool-input-start` 和 `tool-input-delta`；delta 字段为 `inputTextDelta`。
- `node_modules/ai/src/ui/process-ui-message-stream.ts` 在 start 时建立 `input-streaming` 工具 part，在 delta 时累积参数文本并调用公共 `parsePartialJson`。
- `node_modules/ai/src/util/parse-partial-json.ts` 会先尝试正常 JSON 解析，失败后修复未闭合 JSON，再返回 `successful-parse`、`repaired-parse` 或失败状态。
- `node_modules/ai/src/generate-text/stop-condition.ts` 的 `hasToolCall(...toolNames)` 会在最近一步包含目标工具调用时终止 loop。
- 对应官方文档：[UI Message Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)、[`hasToolCall()`](https://ai-sdk.dev/docs/reference/ai-sdk-core/has-tool-call)。

结论：不需要自建第二套 SSE 协议，也不需要等待完整 input；AI SDK 已经提供所需生命周期和局部 JSON 能力。

## 4. 行业设计证据

当总工作量未知时，不应展示伪造百分比。通行做法是：

- 立即显示稳定、原位的任务占位符；
- 使用不确定进度动画；
- 配合准确、简短的当前阶段说明；
- 有真实增量时展示可验证的计数或部分结果；
- 提供停止能力；
- 完成后在原位替换，不让布局跳动。

参考：

- [Apple Human Interface Guidelines — Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
- [Microsoft Windows — Progress controls](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/progress-controls)
- [AI SDK UI tool states](https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message)

## 5. 结论与落地决策

### 5.1 最终状态序列

```text
pending（三点等待）
→ tool-input-start：不可点击 Markdown 进度卡
→ tool-input-delta：标题 / 字符数 / 行数 / 最近章节
→ tool-input-available：原子替换为正式可点击 Artifact
→ finish：消息 done
```

### 5.2 不展示百分比

模型不会提前声明文档最终长度，无法计算可信的完成率。因此卡片使用循环 loading，并展示真实、单调演进的信息：

- 局部文档标题；
- 当前 Markdown 字符数；
- 当前行数；
- 最近三个 ATX 标题。

### 5.3 局部正文不持久化

局部工具 JSON 只保存在单次流 dispatcher 的内存 Map 中。消息临时态只保存展示需要的摘要计数；`saveTree` 前显式剥离，加载 sanitize 也会清理。只有完整、已验证的 input 才注册为 Artifact。

### 5.4 Markdown 工具是本轮最终输出

服务端使用 `hasToolCall(createMarkdownArtifact)` 停止 loop。卡片本身就是完成反馈，不再让模型进行第二轮 recap。这同时降低完成延迟、输出 token 和界面噪声。

### 5.5 空白不算正文

列视图和画布都以 `msg.text.trim()` 判断正文可见性：只有空白时显示 typing，不显示 caret。controller 的有效正文字符计数忽略所有空白字符，纯空白流会进入可重试的空回复错误，而不是静默完成。

## 6. 验收证据

自动化覆盖：

- start → delta → complete 的事件顺序；
- 局部 JSON 标题、字符数、行数和最近章节；
- 进度写入 store 后的临时展示；
- 完整 Artifact 原子清除进度并绑定消息；
- 存盘前剥离临时态；
- sanitize 清理旧快照临时态；
- retry、Artifact-only 终态与上下文回放回归。

执行命令：

```bash
pnpm typecheck
node --experimental-strip-types e2e/thread-chat/markdown-artifact.test.mjs
node --experimental-strip-types e2e/thread-chat/markdown-artifact-state.test.mjs
```
