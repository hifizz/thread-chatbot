## ADDED Requirements

### Requirement: 唯一有序内容协议
系统 SHALL 使用同一 Zod Schema 定义 text、file、quote、artifact-reference 的有序消息内容，类型从 Schema 推导；内部命令 MUST NOT 同时接受 text/files/parts 作为可竞争的内容来源。

#### Scenario: 内容类型扩展
- **WHEN** 内容协议增加一种类型
- **THEN** 穷尽转换检查暴露遗漏；发送、编辑和分叉编排无需新增类型特判

#### Scenario: 文字与重复引用规范化
- **WHEN** 消息含空 text、相邻 text、空格及重复 Artifact 引用
- **THEN** 仅允许忽略零长度 text 和合并相邻 text，保留空格、引用次数与所有非文本 Part 顺序

### Requirement: 明确的发送和分叉首问
系统 SHALL 以 content 作为发送/编辑的唯一内容参数，以 firstTurn 的存在性决定是否创建分叉首问，HTTP v1 SHALL 继续使用已有 parts 格式。

#### Scenario: 只提供结构化首问
- **WHEN** 调用方提供 firstTurn，其中包含非空文字与 Artifact 引用，未提供独立 text 字段
- **THEN** 新 Thread 创建并保存首问，触发生成且引用不丢失

#### Scenario: 空分叉
- **WHEN** firstTurn 不存在
- **THEN** 创建空分叉而不创建用户消息或启动模型；已有 Fork 来源约束继续生效

#### Scenario: 首问内容无效
- **WHEN** firstTurn 存在但不符合内容 Schema 或没有非空问题文字
- **THEN** 返回校验错误，不悄悄创建空分叉

### Requirement: 编辑完整保序并保护来源快照
系统 SHALL 从已保存 Parts 恢复完整草稿，并提交完整编辑结果；MUST NOT 将 Quote、File 或 Artifact 引用按类型重新分组。已有 Quote 胶囊只读、可删除；本期不提供拖动、排序、复制、新增或修改 comment 的交互。旧版仅含 text 的 Quote 允许编辑时回传原快照，服务端按原顺序匹配原快照子序列，拒绝新增、复制和修改正文；新消息拒绝旧版 Quote。

#### Scenario: 交错内容编辑
- **WHEN** 原消息顺序为文字、File、引用 A、Quote、文字、引用 A，用户仅修改末段文字
- **THEN** 新消息保留其他 Part 的身份、重复次数与相对顺序

#### Scenario: 删除分叉首问 Quote
- **WHEN** 用户删除原分叉首问的 Quote 并保留有效问题文字
- **THEN** 编辑可以提交，不重新插回 Quote；保留 Quote 时依据旧快照校验父 Thread 来源

### Requirement: 重试与兼容读取
系统 SHALL 复用持久化用户消息执行重试，保留既有替代消息及 forkContext 机制，不从展示文字重建正文。

#### Scenario: 重试与历史引用
- **WHEN** 用户重试包含引用、附件及 Quote 的消息
- **THEN** 原 Parts 不被改写，生成读取同一固定内容

#### Scenario: 已有消息与网络重试
- **WHEN** 读取已有 text/file/quote 消息或重试同一次发送请求
- **THEN** 旧消息保持可用，发送重试复用相同幂等命令 ID，不重复创建消息
