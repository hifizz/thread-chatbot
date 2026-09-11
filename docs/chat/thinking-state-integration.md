# 正式聊天的思考与工具时间线

## 行为

`/thread-chat` 的列视图和画布展开视图共用 `AnchoredAssistantBody`。按原始 parts 顺序平铺：每段 reasoning、每次工具调用分别是同级区块，最终回答与中间正文保留原位置和锚点能力。没有总的 Thinking 容器，也没有第二层“思考中”标题。

- 每段思考默认折叠；标题外置，展开后直接看到正文。正文用 HeroUI ScrollShadow 限高滚动，最多 360px 且不超过半屏，上下 24px 渐隐。
- 思考标题只复用该段紧接着发起的工具所对应的现有研究子问题原文；未知关联、多个不同问题、没有计划时显示 `Thinking...`。不会把后面另一段的问题拿来给前面的思考命名。
- 标题单行省略，悬停可查看原文；仅正在输出的思考显示流光。不会额外调用模型或从正文猜测标题。
- 工具默认是一行查询或网址，展开可看来源。取消调用计数、整份研究计划、重复的成功状态和警告图标。
- 单次工具失败仅在工具详情里弱提示，整轮回答失败才在对话中提示并提供重试。
- 原生工具与派生活动按 toolCallId 去重；数据保留真实状态，未返回结果的工具不标记为成功。
- 所有样式复用 `.tc` 语义 token，支持暗色与减少动态效果设置，不加载 HeroUI 全局主题。

## 数据与边界

原生 AI SDK UIMessage tool part 是工具状态的优先来源；派生 `data-research-activity` 用于兼容已有消息，不重复渲染同一调用。停止消息的未完成步骤由消息终态显示为已停止。

新增可选的 `subquestionId` 随原有 JSON 消息持久化；未改变数据库结构、模型配置、计费或停止接口。研究计划存在不意味着子问题已经完成，界面不按来源数量推算完成比例。

模型可能先输出说明文字再调用工具。这些文字保留在原位置，后续步骤在对应位置平铺展示，不将已经输出的正文移走。

## 验证

以下为先前模型接入阶段的验证；最新精简布局需另外完成浏览器复验：

- DeepSeek V4 Flash：真实联网搜索、网页读取、后续推理与最终回答，刷新后保留顺序。
- GLM-5.3-Flash：真实研究计划、多个搜索与读取；上游工具失败后模型继续重试，错误与成功分别保留。
- 使用已有子问题 ID 的 GLM 研究调用，标题直接匹配计划问题，浏览器计算样式为 `assistant-trace-shimmer`。

回归命令：

```sh
pnpm typecheck
node --import tsx e2e/thread-chat/assistant-trace.test.mjs
node --import tsx e2e/thread-chat/normalized-ui-message-pipeline.test.mjs
node --import tsx e2e/thread-chat/conversation-message.test.mjs
node --import tsx e2e/thread-chat/ui-message-parts-rendering.test.mjs
node --import tsx e2e/thread-chat/research-events.test.mjs
node --import tsx e2e/thread-chat/research-router-context.test.mjs
```
