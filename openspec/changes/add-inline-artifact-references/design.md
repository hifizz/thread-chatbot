# 设计

## 编辑与领域协议

Lexical 仅承载普通文字、换行及行内 Artifact token。编辑器 JSON 不作为持久消息协议；转换为有序 text / artifact-reference Parts。附件与已有 Quote 保持独立类型，不将全文引用伪装成 TextAnchor。

候选来源复用当前 Project 的 normalized Artifact store，按标题、类型和来源 Thread 搜索；没有 Thread 过滤。重复提及保留各自位置，单条消息仅首次展开同一 Artifact 正文。

## 信任与冻结

客户端仅提交 Artifact ID，显示标题不作为权威数据。发送和编辑在已有事务内按 projectId 批量查找，检查来源 completed，补全标题、类型、threadId、sourceMessageId。消息保存固定 ID 和来源元信息；正文读取现有不可变 Artifact。历史不跟随重新生成的新 ID。

引用全文以数据内容编入原 user message 的相应位置，不改变 System 或工具集合。不自动递归加载来源 Thread，也不自动加载未引用 Artifact。每条消息设明确的引用数量与全文字符预算，超出拒绝并提示，不静默截断。

## 生命周期

Composer 草稿按 Project + Thread 隔离，并在列/画布切换时复用。发送采用草稿快照，成功只清理与已提交快照相同的内容；失败保留文字、引用和附件。编辑从完整消息 Parts 恢复，保留附件和已有 Quote；允许新增、删除、重排 Artifact 引用。Retry 直接复用持久化消息，Fork 继承冻结消息 ID。

## 验证

协议 round-trip、同 Project 各种 Thread 关系与自己、拒绝跨 Project 和未完成来源、重复提及与预算、历史稳定、编辑保留引用。浏览器验证输入法、选择菜单、删除、Undo/Redo、复制粘贴、窄列与画布；执行仓库类型检查及 OpenSpec 验证。
