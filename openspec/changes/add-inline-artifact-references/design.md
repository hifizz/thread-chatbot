# 设计

## 编辑与领域协议

Lexical 仅承载普通文字、换行及行内 Artifact token。编辑器 JSON 不作为持久消息协议；转换为有序 text / artifact-reference Parts。附件与已有 Quote 保持独立类型，不将全文引用伪装成 TextAnchor。

候选来源复用当前 Project 的 normalized Artifact store，按标题、类型和来源 Thread 搜索；没有 Thread 过滤。重复提及保留各自位置，正文按本次实际发送的模型上下文去重。

## 信任与冻结

客户端仅提交 Artifact ID，显示标题不作为权威数据。发送和编辑在已有事务内按 projectId 批量查找，检查来源 completed，补全标题、类型、threadId、sourceMessageId。消息保存固定 ID 和来源元信息；正文读取现有不可变 Artifact。历史不跟随重新生成的新 ID。

引用全文以数据内容编入首次需要正文的 user message 的相应位置，不改变 System 或工具集合。不自动递归加载来源 Thread，也不自动加载未引用 Artifact。每条消息设明确的引用数量与全文字符预算，超出拒绝并提示，不静默截断。

## 上下文去重与缓存

在消息筛选、forkContext 拼接及附件处理完成后，按消息与 Parts 顺序单向扫描，每次编译使用独立的已包含 ID 集合。来源工具必须是 SDK 会保留的非 preliminary、output-available 记录，并匹配来源消息、派生 Artifact ID、回传 ID、类型、标题与完整正文，才计为已包含。工具调用记录本身保持原样。

前文没有完整正文时，首次显式引用展开全文；前文已包含源工具正文或已展开引用时，仅写入固定 JSON 标记：`{"contextType":"artifact-reference","artifactId":"固定产物 ID","title":"冻结标题","previouslyIncludedInContext":true}`。字段顺序固定，不带时间、轮次、索引或当前 Thread 信息；Artifact ID 指向前文工具结果或首次引用，不依赖易变的位置编号。

不得预扫描后文再删除前文正文。追加追问不改变历史模型消息，重试相同输入得到相同结果。源消息被排除或未来裁剪历史后，仍须保证剩余上下文首次引用提供全文。此优化保留当前 Thread 自引用及跨 Thread 权限，不修改数据库 Parts。部署新编译策略会改变原先重复展开的历史请求前缀一次，后续遵循稳定前缀；不承诺复用旧策略缓存或提供商必然命中缓存。

## 生命周期

Composer 草稿按 Project + Thread 隔离，并在列/画布切换时复用。发送采用草稿快照，成功只清理与已提交快照相同的内容；失败保留文字、引用和附件。编辑从完整消息 Parts 恢复，保留附件和已有 Quote；允许新增、删除、重排 Artifact 引用。Retry 直接复用持久化消息，Fork 继承冻结消息 ID。

## 验证

协议 round-trip、同 Project 各种 Thread 关系与自己、拒绝跨 Project 和未完成来源、重复提及与预算、历史稳定、编辑保留引用。浏览器验证输入法、选择菜单、删除、Undo/Redo、复制粘贴、窄列与画布；执行仓库类型检查及 OpenSpec 验证。
