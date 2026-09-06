# 普通文字与行内 Artifact 引用

## Why

Project 已经汇集各 Thread 的工作成果，但用户仍需复制正文才能在其他讨论中复用。Issue #68 的下一阶段以明确的 Artifact 引用完成分叉探索后的比较、综合与继续讨论。

## What Changes

- Thread Composer 支持普通文字与行内 Artifact 原子节点混排，保留现有外观及附件区。
- 当前 Project 的所有 Thread 都能引用所有已完成的 Artifact，包括自己、父级、子级、兄弟和深层分支；主线没有特殊权限。
- 引用固定不可变 Artifact ID，经服务端归属校验后持久化在有序消息 Parts 中，并确定性地进入模型上下文。
- 普通发送、分支首轮、编辑、重试、刷新及历史点击保持引用身份和顺序。

## Capabilities

### New Capabilities
- `inline-artifact-references`: 行内引用的编辑、校验、保存、展示与上下文编译。

## Impact

Composer、消息协议、发送与编辑链路、模型上下文编译器、用户消息展示。新增 Lexical 直接依赖；复用现有 JSONB 消息和 Artifact，不新增表或 migration。不实现 @Thread、@Message、@File、Slash、Revision 或依赖图。
