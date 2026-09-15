## Why

用户阅读评测计划、调研报告或 PRD 的 Markdown Artifact 时，需要直接针对文档中的一段内容展开讨论。目前划选入口只识别消息正文，用户必须复制文字再解释来源，探索过程不连续。

本 Change 打通“打开产物 → 划选 → 开分支 → 返回原文”，为后续项目文档协作建立明确的来源关系。

## What Changes

- 已完成的 Markdown Artifact 支持划选后“此处提问”，复用桌面浮层、手机 Drawer、临时高亮和现有列放置规则。
- 第一版固定从 Artifact 的来源 Thread、来源 Message 分叉；从项目面板或消息卡片打开同一产物，父子关系一致。
- Thread 新增可空 `forkArtifactId`，复用 `forkMessageId`、`forkAnchor`、`anchorText`、`forkContext`；现有消息正文分支按 `null` 兼容。
- 扩展现有 Fork 命令和 Artifact Quote 校验，支持带问提交及留空创建分支；Quote 保持可删除，不因 Thread 保存锚点就重新合成。
- 通过冻结历史带入固定 Artifact 全文；来源工具输入已完整包含正文时不重复注入，缺失时展开权威正文，并让后代 Thread 继续继承祖先 Artifact。
- 支持从分支来源和实际 Artifact Quote 打开原 Artifact、精确定位选区并短暂高亮；定位失败明确提示且等待渲染有上限。
- 扩展唯一划选监听器识别 Artifact 阅读区，保持 Markdown 渲染与业务操作分离。

## Capabilities

### New Capabilities

- `markdown-artifact-forks`: Markdown 产物选区分支的交互、持久化、命令、引用、上下文、来源导航与兼容验收。

### Modified Capabilities

- `domain`: 扩展 Fork 的来源定义，明确消息正文与消息产物两种选区，以及 Artifact 分支的父节点规则。

## Impact

- 前端：`app/thread-chat/branching/selection/`、`orchestration/artifacts/`、引用来源导航、`net/commands/`、DTO 到视图状态的映射。
- 后端：`lib/thread-chat/contracts/`、`application/fork-thread.ts`、`application/compile-model-context.ts`、Artifact 上下文展开与持久化层。
- 数据：Schema 源码增加 `threads.fork_artifact_id`、外键及查询索引；正式 migration 按设计留给 `develop` 集成任务统一生成、验证。
- 兼容：保留旧 Fork 请求与旧 Thread；不扩大普通跨 Thread Quote 权限。现有 `thread-chat-message-quotes` 中“分支首问仅 Message 来源”的限制，在本能力下增加精确绑定当前 Fork 的 Artifact 来源分支；引用删除和历史回放约束继续适用。
- 不包括：文件编辑、Document/Revision 表、To-Do 状态、并发合并、自动回写主线、整份文档无需划选开分支、任意选择父 Thread、Code/Note 或上传附件划选。
- 不新增运行时依赖；Markdown 可见文本转换使用仓库内零依赖纯函数。
