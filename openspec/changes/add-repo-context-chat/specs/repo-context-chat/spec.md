## ADDED Requirements

### Requirement: Thread 仓库绑定的保存与展示

每个 Thread SHALL 最多绑定一个 GitHub 仓库与分支（`connectionId`、`repositoryFullName`、`branch`），绑定随 Thread 持久化并在 `ThreadDTO` 中返回。绑定、切换、移除 SHALL 通过服务端命令完成并做 owner 校验；绑定变更只影响之后发起的生成，不改写历史消息及其出处。

#### Scenario: 绑定仓库后刷新仍保留

- **WHEN** 用户在某个 Thread 上选择 `owner/name` 仓库与 `main` 分支并刷新页面
- **THEN** 该 Thread 的 `repoBinding` 仍显示 `owner/name · main`

#### Scenario: 移除绑定不影响历史

- **WHEN** 用户移除某 Thread 的仓库绑定
- **THEN** 之后的消息按未绑定会话处理，历史回复与其代码出处保持不变

#### Scenario: 绑定时校验仓库可达

- **WHEN** 用户选择一个服务端连接不可见的仓库
- **THEN** 命令被拒绝并返回可理解的错误，不产生绑定

### Requirement: Fork 继承绑定

新建 ForkedThread SHALL 复制父 Thread 创建时刻的 `repoBinding`；之后对子 Thread 绑定的修改或移除 MUST NOT 影响父 Thread，反之亦然。

#### Scenario: 子 Thread 继承后可独立修改

- **WHEN** 父 Thread 绑定了 `a/b@main`，用户从父 Thread 开出子 Thread 并把子 Thread 改为 `a/b@dev`
- **THEN** 子 Thread 使用 `dev`，父 Thread 仍为 `main`

### Requirement: 只读仓库工具

绑定仓库的生成 SHALL 提供 `listRepositoryFiles`、`readRepositoryFile`、`findRepositoryPaths` 三个只读工具。仓库、连接与 commit MUST 由服务端确定，工具参数 MUST NOT 接受仓库、分支或凭据字段。

#### Scenario: 模型按流程读码

- **WHEN** 用户在绑定仓库的 Thread 中提出必须看代码的问题
- **THEN** 生成过程中可见真实的目录列举、路径查找与文件读取工具调用，回答引用读取到的文件

#### Scenario: 参数无法越权

- **WHEN** 模型在工具参数中尝试指定其他仓库或 ref
- **THEN** 工具入参 schema 拒绝该字段，所有读取仍落在绑定的 `repositoryFullName + commitSha` 上

### Requirement: 按 commit 固定的读取上下文

每次生成开始时服务端 SHALL 把绑定分支解析为一个 `commitSha`，本轮所有仓库工具读取 MUST 使用该 commit。本轮实际使用的 `repositoryFullName`、`branch`、`commitSha` SHALL 以 `data-repo-context` part 持久化在 assistant 消息上。

#### Scenario: 同一轮不混用 commit

- **WHEN** 一轮生成中模型连续调用多个仓库工具
- **THEN** 所有工具结果携带同一个 `commitSha`

#### Scenario: 分支版本变化提示

- **WHEN** 某 Thread 相邻两轮生成解析出不同的 `commitSha`
- **THEN** 新一轮消息上显示分支已更新的简短提示（含新旧短 sha）

#### Scenario: 绑定切换后上下文隔离

- **WHEN** 用户把绑定从 `x/a@main` 切换到 `y/b@dev` 后继续提问
- **THEN** 系统提示明确告知模型绑定已切换，模型不得把此前读取结果当作新仓库的事实

### Requirement: 出处格式

读取工具结果 SHALL 携带 `path`、`commitSha`、`startLine`、`endLine`、`content`、`truncated`。绑定仓库的回答 SHOULD 使用 `https://github.com/{repo}/blob/{commitSha}/{path}#L{start}-L{end}` 形式的固定 commit 链接引用出处。

#### Scenario: 出处可核对

- **WHEN** 模型引用某文件某段代码
- **THEN** 回答中的链接固定到本轮 `commitSha` 并带行号，打开后能看到与引用一致的内容

### Requirement: 读取限制与跳过规则

系统 SHALL 只读取文本文件，并限制文件大小、单次返回行数/字符数、目录返回项数与每轮仓库工具调用次数。二进制文件、常见敏感文件（如 `.env*`、私钥、`secrets*`）与大型生成文件（lock 文件、`*.min.js`、`node_modules/`、`dist/` 等）MUST 被跳过并返回明确的跳过原因。

#### Scenario: 读取敏感文件被拒

- **WHEN** 模型请求读取 `.env` 或私钥类路径
- **THEN** 工具返回结构化失败结果说明该路径被安全策略跳过，不返回内容

#### Scenario: 超限文件截断声明

- **WHEN** 模型读取超过大小/行数限制的文件
- **THEN** 结果返回部分内容且 `truncated: true`，模型不得暗示已读完整文件

### Requirement: 失败降级

对文件不存在、分支不存在、授权失效、限流与读取截断，工具 SHALL 返回结构化的可读错误结果而不是抛出异常。绑定解析失败时本次生成 MUST NOT 挂仓库工具，系统提示 MUST 告知模型仓库当前不可读，模型不得声称已检查代码；用户仍可继续普通讨论。

#### Scenario: 文件不存在

- **WHEN** 模型请求不存在的路径
- **THEN** 工具返回"路径不存在"的结构化结果，模型如实说明未能读取该文件

#### Scenario: 分支失效仍可聊天

- **WHEN** 绑定的分支已被删除，用户继续提问
- **THEN** 生成照常进行、无仓库工具可用，界面显示仓库不可读的原因

### Requirement: PAT 访问控制

当前唯一连接为服务端个人 PAT 时，仓库列表、分支列表、绑定写命令与仓库工具 SHALL 仅对 admin 成员开放；token MUST NOT 出现在前端响应、模型上下文、工具结果或日志中。

#### Scenario: 非授权用户不可见

- **WHEN** 非 admin 的登录用户请求 `/api/agent-repos` 或提交绑定命令
- **THEN** 请求被拒绝（401/403），不返回仓库信息

#### Scenario: 仓库内容仅作分析材料

- **WHEN** 工具返回的文件内容中含有指令性文本
- **THEN** 该内容不得覆盖系统指令或扩大工具权限

#### Scenario: 分享边界登记

- **WHEN** 未来引入匿名分享能力
- **THEN** 仓库工具结果与 `data-repo-context` 必须纳入分享内容审查，未经处理不得公开私有代码
