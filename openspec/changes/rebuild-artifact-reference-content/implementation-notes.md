# 实现记录

## 基线与入口核对（T1.1）

实现基线为 main `7da00ea`，提案提交为 `d063d99`。#93 仅作行为参考。

- 客户端操作入口：`app/thread-chat/net/commands/conversation-commands.ts`；目前仍有 text/files，完整 content 切换未完成。
- 产品调用：`thread-chat-demo.tsx`，列模式 `chat-view.tsx`，画布 `canvas-expand.tsx`；消息编辑经过 `message-action-commands.ts` 与 `editable-user-message.tsx`。
- 服务端写入：`send-message.ts`、`edit-turn.ts`、`fork-thread.ts`、`start-project.ts`；事务、所有权锁和幂等已有实现，应保留。
- 草稿：`contracts/composer.ts`；main 输入框尚为 textarea，本地附件状态独立。
- 历史与模型：`compile-model-context.ts` 选取冻结分叉历史及当前消息，再处理附件；最终请求在 `streaming/generation-plan.ts`。
- Artifact 写入：`streaming/finalize.ts` 在消息 generating 状态的条件更新成功后插入产物，不覆盖同 ID；尚缺真实数据库不变量测试。
- main 已有分叉首问与旧 Quote 保留修复，#93 相对 main 还包含 Mermaid 等不相关差异，不能整批复制。

## 已落地的基础代码

- 引用输入与持久快照 Schema、UI Part 类型、有序往返转换和保序规范化函数。
- Repository 的 Project 范围批量读取与来源状态返回。
- 单一用户内容解析函数，包括文件、Quote、引用合法性及单消息预算；尚未替换现有写入入口。
- 模型引用展开归位应用层，接入实际上下文编译，保留固定重复标记和前向去重。
- 有序内容及真实 AI SDK 消息转换测试。验证结果见下方。

以上为基础提交，不代表输入框或完整功能可发布。服务端写入入口及客户端仍保留 main 行为，避免在完整切换前破坏旧消息。

## 需要确认：旧版 Quote 的编辑协议

仓库 `contracts/quote.ts` 和 `domain/user-message-parts.ts` 明确允许读取旧版 `{text}` Quote，但禁止把它作为新命令输入。现有编辑通过 `buildEditedUserParts` 从旧消息自动插回；`fork-quote.test.mjs` 有专门回归用例。

提案同时要求完整有序内容是唯一提交来源、Quote 可以删除/排序、旧消息继续可编辑。对只有 `{text}`、没有来源快照的旧版 Quote，当前输入 Schema 无法同时满足这些要求；不能伪造 messageId/anchor 升级它，也不能静默丢失它。

建议的小范围协议补充：

- quote 输入允许旧版 `{text}`，仅限编辑时逐项匹配原消息中的旧快照。
- 服务端按原快照出现次数校验，允许保留/删除/排序，拒绝新增、复制和修改正文。
- send/start/fork 的新消息继续拒绝旧版 Quote。
- 数据库不迁移，来源不补造，持久化格式不变；客户端提交的完整内容决定最终顺序。

该补充需要更新 design、ordered-message-content 规格与任务验收；尚未实施。依据 openspec-apply-change 的设计冲突暂停规则，等待用户确认后继续，不将部分实现标记完成。

## 本轮验证结果

基于上述提案提交的本次工作树：

- `npx --yes pnpm@10.32.1 typecheck`：通过，退出码 0。
- `node --import tsx e2e/thread-chat/artifact-content-core.test.mjs`：通过；覆盖交错 Part 往返、严格 Schema、重复引用、原消息不变与前缀稳定。
- `node --import tsx e2e/thread-chat/artifact-reference-context.test.mjs`：通过；调用实际 AI SDK 转换，覆盖自身/分叉来源、临时与不完整工具、错误身份、重复标记和裁剪后展开。
- `node --import tsx e2e/thread-chat/fork-quote.test.mjs`：通过；保留 main 的分叉两入口、Quote 展示和编辑回归。
- `openspec validate rebuild-artifact-reference-content --strict --no-interactive`：通过。
- `git diff --check`：通过。

任务完成 3/25：1.1、3.1、3.2。没有运行真实数据库、浏览器或模型 E2E；没有数据库迁移、输入框改动或发布操作。运行环境全局 pnpm 与项目版本不同，使用项目锁定 pnpm 10.32.1 完成 frozen-lockfile 安装与类型检查，未修改锁文件。
