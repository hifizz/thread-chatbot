## Why

PR #93 已证明行内 Artifact 引用的核心行为可行，但 text/files/parts 多内容来源、编辑重排和输入框内部定位补丁使后续维护依赖散落的特殊分支。基于最新 main 新开分支，先固定消息内容协议和实体不变量，再选择性移植经过验证的引用逻辑，并按 Lexical 官方机制重新组织输入框。

## What Changes

- **BREAKING（仓库内部 TypeScript 调用）**：发送、编辑统一接收 MessageContentInput，分叉首问使用显式 firstTurn；删除并列 text/files/parts? 内容参数及回退拼接。HTTP v1 继续使用已有有序 parts，不额外引入第二种网络封装。
- 统一 Schema、草稿导出、持久化恢复及内容派生规则；编辑保留所有 Part 的身份与相对顺序，重试复用已保存消息。
- 支持同 Project 任意 Thread 引用已完成的 Markdown Artifact，包括当前 Thread；服务端解析 ID、校验范围，冻结引用元信息，保持产物不可变。
- 保留前向正文去重及固定模型引用标记；明确单消息接收限制与整轮上下文预算的不同职责。
- 输入框按官方 Node、Plugin、Command 和序列化接口拆分；隔离草稿、资源订阅和历史导航；不移植内部 DOM 定位覆盖。
- 官方机制不能满足已确认交互时，提交最小复现和能力差距并向用户求助，不自行叠加兼容补丁。
- 将两轮审查整合为 T1–T5，补全真实浏览器、数据库和模型验收证据。

## Capabilities

### New Capabilities

- `ordered-message-content`：唯一有序内容协议与发送、编辑、分叉、重试的操作契约。
- `inline-artifact-references`：权威引用解析、固定产物回放、模型上下文展开与预算。
- `lexical-message-composer`：基于 Lexical 官方扩展点的输入、草稿同步和引用交互。

### Modified Capabilities

无。现有主规格中的领域拓扑、标题及 Markdown 展示要求不变；#93 的 inline-artifact-references 尚未进入 main，本变更独立完整定义该能力。

## Impact

- 基线：main `7da00eaba9fb116a4ff4612b08005f51e886cd45`。
- 新分支：`codex/rebuild-artifact-reference-content`。
- 行为参考：[PR #93](https://github.com/hifizz/thread-chatbot/pull/93)，审查 HEAD `6b4019fb3f764e6b89cb8029a6dd4cf3afe4e74b`。不整体合并或 cherry-pick 该 PR。
- 涉及现有 contracts、application、persistence、上下文编译、客户端命令、列/画布输入框与消息编辑展示。
- 复用 messages.parts JSONB 和现有 Artifact 表；预期无需数据库结构或 migration 变更。直接使用的 Lexical 包显式声明依赖，版本与已锁定的 0.45.0 家族对齐。
- 本提交只包含 OpenSpec 规划文档。实现阶段保留已有权限、事务、幂等、生成和历史替代机制。

## Non-goals

不重写整个 ThreadChat；不新增通用引用框架、Provider/Resolver 注册表、Reference 实体、Thread—Artifact 关联表、Artifact Revision 表；不实现 Slash Skill、跨 Project 引用、分享、办公文档解析、全文检索或自动上下文摘要。
