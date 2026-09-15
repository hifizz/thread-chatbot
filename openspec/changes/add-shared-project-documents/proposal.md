## Why

用户在主线创建计划、调研报告或 PRD 后，需要在多个 Thread 分头探索，并把已采纳结论写回同一份项目文档。目前 Artifact 是消息所属的固定产物，既没有持续文档身份，也没有防止异步修改互相覆盖的提交协议。

本 Change 接续 #143 的 `add-markdown-artifact-forks`，定义“并行讨论 → 读取最新文档 → 提交局部修改 → 保存历史 → 所有 Thread 后台获知变化”。本 PR 现已进入实施，完成状态与本地验收门槛见 implementation.md。

## What Changes

- 增加 Project 所属 Document 和不可变 DocumentRevision；每版正文复用一个固定 Artifact，原 Artifact ID、正文、来源和历史引用不变。
- 用户可在任意同 Project Thread 用自然语言要求更新指定文档，例如“把 @F1 的 TODO6 方案更新为 xx 并勾选完成”；模型通过查找、读取、更新工具完成操作。
- 更新使用 `expectedRevisionId + edits(oldText, newText)`。所有 edits 基于同一版 Markdown 源码定位并原子提交；多个 Thread 思考可并行，数据库只在同一文档提交时短暂协调。
- 整份文档版本变化即返回冲突；模型必须重新读取、审视最新内容并重新生成 edits，不能只换版本号或恢复已删内容。第一版不自动合并。
- 保存版本链、修改说明、来源 Thread/Message、执行身份和幂等收据；停止或重生消息不隐式撤销已提交修改。
- 项目文档默认读最新，历史 Artifact/Quote/Fork/分享快照固定原内容。文档当前版本内划选沿用 #143 的实际 Artifact 来源父节点规则。
- 移除主线待接收面板、范围勾选及恢复默认；所有 Thread 新用户消息后台追加固定更新摘要，AI 按需读取最新版，通知收据与全文读取收据分离。历史通知与读取结果保留，重试不动态改写输入。
- 定义版本阅读、差异查看、工具执行状态、冲突反馈、目录同步 Hook，以及 DTO、模块和验证任务。

## Capabilities

### New Capabilities

- `project-documents`: 持续文档身份、固定版本、Artifact 映射、历史读取、并发提交、来源与数据保留。
- `document-update-tools`: 自然语言目标解析、查找/读取/局部更新工具、写入授权、冲突重试、原子性和幂等执行。
- `document-update-context`: 所有 Thread 后台获知变化、模型输入版本固定、当前/历史阅读、操作反馈及与 Artifact 分支的衔接。

### Modified Capabilities

无现有主规范要求需要覆盖；本期增加独立能力，继续遵守 #143 的 Artifact 固定引用、父节点及 Quote 删除规则。依赖 change 尚未归档，本次不将其重写为已上线主规范。

## Impact

- 依赖：`add-markdown-artifact-forks`（#143）、现有固定 Artifact 引用和有序 Message Parts；本 PR 的合入目标为 #143 的 head 分支，不是 main。
- 数据：新增 documents/document_revisions 和现有命令收据、消息 Part 类型扩展；复用 artifacts 存正文、复用现有生成生命周期。本次修改 Schema 源码，不生成正式 migration。
- 服务端：新增文档应用服务、仓储、工具适配及请求 DTO；扩展统一上下文编译、最终生成产物落库和 read-only 分享序列化。
- 客户端：扩展 ProjectPanel/ArtifactDetail，增加文档版本与变更视图、工具状态卡片、目录同步 Hook；复用现有 Markdown、差异库和组件。
- 范围外：结构化 To-Do、实时多人编辑、CRDT、三方自动合并、跨 Project 写入、批量多文件原子事务、文件系统/沙箱执行、通用事件溯源系统、手动富文本编辑器、自动评测执行。TODO 复选框作为 Markdown 字符处理。
- 发布遵循仓库规则：实施分支只改 Schema 并验证独立数据库；develop 单一集成任务生成、验证迁移后才能发布。
