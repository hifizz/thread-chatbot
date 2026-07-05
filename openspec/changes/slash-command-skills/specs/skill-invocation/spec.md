# skill-invocation

## ADDED Requirements

### Requirement: 仅解析最后一条 user message 的 directive
`POST /api/chat` SHALL 仅从请求消息列表的最后一条 user message 文本中解析 skill directive；历史消息中的 directive MUST NOT 触发重复注入。一条消息含多个 directive 时 SHALL 只取第一个。

#### Scenario: 触发单个 skill
- **WHEN** 最后一条 user message 含 `:skill[翻译]{name=translate} 你好`
- **THEN** 系统识别 skillId 为 `translate` 并进入注入流程

#### Scenario: 多个 directive 只取第一个
- **WHEN** 最后一条 user message 含两个 skill directive
- **THEN** 只有第一个 directive 生效，第二个按普通文本清洗处理

#### Scenario: 历史消息不重复注入
- **WHEN** 仅历史 user message 含 skill directive、最后一条不含
- **THEN** 本次请求不注入任何 skill 正文

### Requirement: 白名单校验
解析出的 skillId SHALL 通过服务端注册表白名单校验；skill 内容 MUST 仅通过注册表按 id 查询获得，MUST NOT 用请求内容拼接文件路径读取。未注册的 id SHALL 被忽略并按无 skill 处理（不报错、正常对话）。

#### Scenario: 未注册的 skillId
- **WHEN** directive 中的 `name` 不在注册表中
- **THEN** 请求按普通消息处理，模型正常回复，不返回错误

### Requirement: system prompt 注入与工具启用
校验通过后，系统 SHALL 将 skill 正文追加到基础 system prompt 之后（以空行分隔）作为本次 `streamText` 调用的 system；若 frontmatter 声明了 `tools`，SHALL 在本次调用中启用注册表内对应的服务端工具。skill 注入 MUST 仅对当前这一次请求生效。

#### Scenario: 注入 skill 正文
- **WHEN** `translate` skill 被触发
- **THEN** 本次模型调用的 system prompt 末尾包含 translate 的 SKILL.md 正文

#### Scenario: 单条消息生效
- **WHEN** 上一条消息触发过 skill、当前消息不含 directive
- **THEN** 当前请求的 system prompt 不含任何 skill 正文

### Requirement: 发给模型的文本清洗 directive 语法
发送给模型的消息文本中，`:skill[label]{name=id}` 语法 SHALL 被替换为可读形式 `/id`（对历史与当前消息一并处理）；数据库中持久化的消息内容 MUST 保持原始 directive 文本不变。

#### Scenario: 模型看到可读指令
- **WHEN** user message 文本为 `:skill[翻译]{name=translate} 你好`
- **THEN** 模型收到的对应文本为 `/translate 你好`，而数据库中仍存原始 directive 文本
