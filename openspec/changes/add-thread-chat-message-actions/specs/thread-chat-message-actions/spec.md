## Purpose

为 thread-chat 提供一致、可恢复且可持久化的消息操作契约，使用户能够复制、编辑、重新生成和评价回复，并让缺失 assistant 的孤儿轮次在刷新后仍有可靠的恢复入口。

## ADDED Requirements

### Requirement: 服务端权威判定轮次恢复状态

系统 SHALL 以已保存的树状态和当前 generation 记录共同判定每一轮的恢复状态；客户端不得仅凭最后一条消息的 role 猜测 generation 已失败。树本身可正常读取但其中一轮需要恢复时，系统 SHALL 正常返回树，并以结构化的 recoverable turn 信息描述该轮问题，而不得把单轮问题升级为整树请求失败。

#### Scenario: 缺失占位但 generation 仍在运行
- **WHEN** 已保存的 user 消息仍有关联的当前 running 或 stop_requested generation，但树快照中的 assistant 占位缺失或陈旧
- **THEN** 系统 SHALL 使用服务端 turn snapshot 修复 assistant 目标并显示后台生成状态，不得把该 user 消息判定为孤儿轮次

#### Scenario: generation 已有终态结果
- **WHEN** 当前 generation 已完成、停止或失败并保存了结构化终态
- **THEN** 系统 SHALL 先合并该终态结果，再决定 UI 状态，不得提供会启动重复模型调用的孤儿重试入口

#### Scenario: 未完成 assistant 没有 generation
- **WHEN** 树中存在 pending 或 streaming assistant，但没有匹配的当前 generation（无论是否已有部分正文或 Artifact）
- **THEN** 系统 SHALL 保留该 assistant 的消息身份和已有内容，将其协调为可重试错误，不得在加载时删除它或把部分输出猜成完成消息

#### Scenario: 最后一条 user 没有 assistant 或 generation
- **WHEN** 某 Thread 的 active leaf 是已提交 user，且不存在以它为 parent 的 assistant 目标或可恢复的当前 generation
- **THEN** 系统 SHALL 返回绑定该 threadId 与 userMessageId 的 recoverable turn，原 user 消息保持成功提交状态

#### Scenario: 单轮异常不阻止树加载
- **WHEN** 一棵可访问的树中包含一个或多个 recoverable turn
- **THEN** 树加载请求 SHALL 返回成功响应、完整可读历史以及 recoverable turn 摘要，而不是返回整树 HTTP error

### Requirement: 孤儿轮次可重新触发生成

系统 SHALL 允许用户从 recoverable orphan user turn 重新生成回复。直接重试 SHALL 复用原 user message identity，并创建新的 assistant child identity；编辑孤儿 user SHALL 创建 sibling user identity 和新的 assistant child，不覆盖已提交的原 user。任何付费模型调用前仍 SHALL 通过包含新节点与 active leaf 的严格持久化屏障。

#### Scenario: 不修改原文直接重试孤儿轮次
- **WHEN** 用户点击孤儿轮次的“重试”
- **THEN** 系统 SHALL 保留原 user messageId 和原文，创建新的 assistant child 占位与 generationId，并在存盘成功后启动回复

#### Scenario: 编辑孤儿消息后发送
- **WHEN** 用户修改 recoverable user 消息并点击“发送”
- **THEN** 系统 SHALL 创建携带新文本和原结构化 quote 的 sibling user、创建其 assistant child，并把新 assistant 设为 active leaf；原 user 节点不得被覆盖

#### Scenario: 恢复前持久化失败
- **WHEN** 编辑或重试后的 user 与 assistant 占位无法通过严格持久化屏障
- **THEN** 系统 SHALL 不调用付费模型，并继续提供可重试错误状态

#### Scenario: 原始输出已永久丢失
- **WHEN** 孤儿轮次不存在可恢复的 generation 终态
- **THEN** 系统 SHALL 明确启动一次新的 generation，不得声称能够恢复原模型调用未持久化的旧输出

### Requirement: 用户消息提供复制与最后一轮编辑

每条 user 消息 SHALL 在 hover、键盘聚焦或等价触摸交互时提供“复制”和“重新编辑”操作。复制 SHALL 写入消息的原始 Markdown 文本，而不是渲染后的 HTML。P0 中只有当前 Thread 的最后一条 user 消息可提交编辑；更早消息的编辑入口 SHALL 明确禁用或解释其不可用原因，不得破坏性截断后续消息或子 Thread。

#### Scenario: 复制用户 Markdown
- **WHEN** 用户点击 user 消息的复制按钮且剪贴板写入成功
- **THEN** 剪贴板 SHALL 得到原始 `msg.text`，按钮 SHALL 在有限时间内显示复制成功状态

#### Scenario: 编辑最后一轮用户消息
- **WHEN** 用户点击当前 Thread 最后一条 user 消息的“重新编辑”
- **THEN** 原气泡 SHALL 原位切换为预填原文的编辑框，并提供取消与发送操作

#### Scenario: 取消编辑
- **WHEN** 用户在 inline editor 中点击取消
- **THEN** 系统 SHALL 恢复原消息展示，不修改持久化内容，也不启动 generation

#### Scenario: 历史用户消息不可破坏性编辑
- **WHEN** 用户查看不是当前 Thread 最后一轮的 user 消息
- **THEN** 系统 SHALL 仍允许复制，但 SHALL NOT 通过本功能修改该消息、删除后续历史或迁移其子 Thread

### Requirement: 编辑与重新生成保留不可变消息版本

系统 SHALL 将已经提交的 user 和 terminal assistant 表示为不可变消息节点。编辑最新 user SHALL 创建 sibling user 及其 assistant child；重新生成最新 assistant SHALL 在同一 user parent 下创建 sibling assistant。系统 SHALL 维护每个 Thread 的 active leaf，并为最新轮次提供可切换的版本序号，不得通过覆盖原 messageId 实现重新生成。

#### Scenario: 重新生成同一问题
- **WHEN** user U 的 assistant A 已完成且用户请求重新生成
- **THEN** 系统 SHALL 创建以 U 为 parent 的 assistant B，把 active leaf 切到 B，并保留 A 的正文、generation、forks 和 Artifact ownership

#### Scenario: 编辑最新问题
- **WHEN** user U1 已有 assistant A 且用户修改 U1 后发送
- **THEN** 系统 SHALL 创建与 U1 同 parent 的 user U2 及其 assistant child B，把 active leaf 切到 B，并保留 U1/A 路径

#### Scenario: 切换最新轮次版本
- **WHEN** 最新轮次存在两个或更多 assistant alternatives 且用户选择另一个版本
- **THEN** 系统 SHALL 切换完整问答 active path，使对应 user、assistant、feedback、inline Artifact 和分支提示一致显示，不得拼接不同版本的 user 与 assistant

#### Scenario: 拒绝旧线性树
- **WHEN** 已保存树缺少当前 schema version、message parent、active leaf 或 Artifact source identity
- **THEN** 系统 SHALL 拒绝把它解释或降级为当前消息图，不得执行隐式迁移、猜测 parent/source 或接受旧客户端覆盖；内测数据通过受控清理重新开始

### Requirement: 消息图和版本选择使用 revision 并发控制

系统 SHALL 为每棵持久化树维护单调 revision。整树保存、generation preparation 和 active-leaf 切换 SHALL 基于服务端 revision 原子提交；陈旧客户端不得以 last-write-wins 覆盖新消息节点、fork、Artifact 或用户明确选择的回复版本。

#### Scenario: 陈旧整树保存
- **WHEN** 客户端以旧 `baseRevision` PUT 整棵树
- **THEN** 服务端 SHALL 返回 `tree_revision_conflict`，不得写入任何 state 字段或自动用陈旧快照重试

#### Scenario: 原子切换回复版本
- **WHEN** 用户选择最新轮次的 assistant alternative A 且客户端 revision 仍为最新
- **THEN** 服务端 SHALL 验证 A 是合法 alternative、原子设置 active leaf 并递增 revision，刷新后继续显示 A

#### Scenario: 切换期间发生并发写入
- **WHEN** active-leaf 命令的 `baseRevision` 已被另一 generation 或树保存推进
- **THEN** 服务端 SHALL 拒绝该命令并让客户端重新加载，不得覆盖较新的消息图

#### Scenario: 旧客户端降写 graph tree
- **WHEN** 已升级的 graph tree 收到不含 `baseRevision` 的旧整树 PUT
- **THEN** 服务端 SHALL 返回 `revision_required`，不得把图结构降写成线性快照

### Requirement: 编辑发送是明确的 generation 替换操作

最后一轮 user 消息的编辑发送 SHALL 创建新的 user/assistant 路径。若旧路径的当前 generation 仍在运行，提交编辑 SHALL 被视为用户明确替换该 attempt；旧 attempt 必须先被停止或 supersede，且其晚到结果不得覆盖或切换新 active leaf。仅进入编辑模式或修改输入框内容不得停止 generation。

#### Scenario: 编辑已有终态回复
- **WHEN** 用户编辑最后一轮 user 消息并发送，且相邻 assistant 已为终态
- **THEN** 系统 SHALL 保留原 user/assistant 节点，创建 sibling user 与新的 assistant message identity、创建新 generationId 并生成新回复

#### Scenario: 编辑仍在生成的最后一轮
- **WHEN** 用户对仍有 running generation 的最后一轮提交编辑
- **THEN** 系统 SHALL 把发送操作视为明确替换，停止或 supersede 旧 attempt 后启动新 attempt，且最多保留一个 current generation

#### Scenario: 只进入编辑模式
- **WHEN** 用户打开编辑器但尚未发送
- **THEN** 当前 generation SHALL 继续保持原状态，系统不得仅因编辑器打开而中止模型或改变计费

### Requirement: Assistant 消息提供复制、重新生成与反馈

只有 `done` 的 assistant 消息 SHALL 在左下方提供复制 Markdown、重新生成、点赞和点踩操作。复制 SHALL 使用回复正文的原始 Markdown；点赞和点踩 SHALL 互斥并只绑定实际被评价的 `messageId`。`pending`、`streaming`、未完成或 `error` assistant SHALL NOT 提供复制、点赞和点踩，失败恢复使用独立 Retry 入口。P0 中只有当前 Thread active path 最后一轮且已完成的 assistant 可执行重新生成；重新生成 SHALL 创建 sibling assistant。更早 assistant 的重新生成入口 SHALL 明确禁用或解释其不可用原因，不得破坏性截断后续历史。

#### Scenario: 复制 assistant Markdown
- **WHEN** 用户点击含正文的 assistant 消息复制按钮
- **THEN** 剪贴板 SHALL 得到该回复的原始 Markdown 正文，并显示有限时长的成功状态

#### Scenario: 重新生成最后一轮完成回复
- **WHEN** 用户点击当前 Thread 最后一轮 `done` assistant 消息的重新生成按钮
- **THEN** 系统 SHALL 创建新的 assistant messageId 与 generationId 并切为 active leaf，立即显示等待状态；原终态回复继续作为可切换版本存在，旧 active attempt 的晚到结果不得覆盖新回复

#### Scenario: 历史 assistant 不可破坏性重新生成
- **WHEN** 用户查看后面仍有对话历史的 assistant 消息
- **THEN** 系统 SHALL 在该消息已经完成时仍允许复制和评价该 message，但 SHALL NOT 通过本功能重置该消息、删除后续历史或迁移其子 Thread

#### Scenario: 无正文不可复制
- **WHEN** assistant 消息没有可复制的 Markdown 正文
- **THEN** 复制操作 SHALL 禁用或不显示，不得把错误文案、DOM 文本或独立 Artifact 冒充回复正文写入剪贴板

#### Scenario: 未完成回复不显示产品操作
- **WHEN** assistant 消息仍为 pending、streaming、error 或其他未完成状态
- **THEN** 系统 SHALL 隐藏或禁用复制、点赞和点踩；error 消息可显示独立 Retry，但不得把执行失败伪装成已完成且可评价的回复

#### Scenario: 反馈按钮互斥
- **WHEN** 用户对同一 assistant message 先点赞后点踩
- **THEN** 系统 SHALL 将该 message 的当前反馈更新为 negative，并只显示点踩选中态

#### Scenario: 同一反馈重复提交
- **WHEN** 用户对同一 assistant message 重复提交相同反馈
- **THEN** 服务端 SHALL 幂等保存一个结果，UI SHALL 保持同一选中态

#### Scenario: 完成消息不依赖前端 generationId
- **WHEN** assistant message 已为 `done` 且具有稳定 messageId，但当前 UI view model 没有携带 generationId
- **THEN** 复制、点赞和点踩 SHALL 正常可用；服务端需要执行数据时 SHALL 通过 messageId 反查，不得提示“没有可评价的 generation”

### Requirement: 划选子 Thread 永久绑定来源消息版本

划选 assistant 内容创建的 child Thread SHALL 以不可变 source assistant messageId 表示来源。父 Thread 切换到 sibling assistant 后，child Thread SHALL 保持可读、可继续对话并继续继承原 source 路径，不得改绑到新回复或按相似 quote 猜测迁移。

#### Scenario: 来源 A 生成后切换到 B
- **WHEN** child Thread X 从 assistant A 的划选文本创建，随后父 Thread 重新生成并切换到 assistant B
- **THEN** X SHALL 继续以 A 为 `forkFromMsgId`，其继承上下文仍截止到 A，且 A 节点不得删除

#### Scenario: 已打开的来源分栏变为非当前版本
- **WHEN** X 的右侧分栏已经打开且父列从 A 切换到 B
- **THEN** 系统 SHALL 保持 X 分栏打开，标注它基于当前未展示的回复版本，并提供切回 A 的“查看来源”操作

#### Scenario: 非当前版本的未打开子分支
- **WHEN** A 有 child Thread 但父列当前显示 B
- **THEN** B 的正文 SHALL NOT 显示 A 的锚点脚注；用户仍 SHALL 能通过版本分支数量、子树切换器或画布发现 A 的 child Thread

#### Scenario: 从 B 创建新分支
- **WHEN** 用户在 assistant B 上划选文字创建 child Thread Y
- **THEN** Y SHALL 只绑定 B，不得因 A 存在相同文本而绑定或迁移到 A

### Requirement: Artifact 随来源消息版本保留

每个 Artifact SHALL 绑定产生它的 assistant messageId。重新生成 SHALL 保留旧回复 Artifact，不得自动删除；默认界面可按 active path 过滤，但必须让用户能够通过切换回复版本、打开派生 Thread 或历史资产入口重新访问旧 Artifact。

#### Scenario: A 与 B 分别生成 Artifact
- **WHEN** assistant A 生成 Artifact A，随后 sibling assistant B 生成 Artifact B
- **THEN** Artifact A SHALL 继续绑定 A，Artifact B SHALL 绑定 B，二者不得覆盖、合并或互换 ownership

#### Scenario: 当前版本默认展示
- **WHEN** 父 Thread 当前 active leaf 为 B
- **THEN** inline Artifact 与默认 drawer 视图 SHALL 以 B 的 active path 为准；Artifact A 可被标记为历史版本但不得从持久化 registry 删除

#### Scenario: 已打开历史 Artifact
- **WHEN** 用户正在查看 Artifact A 后切换到 B
- **THEN** 系统 SHALL NOT 强制关闭该 Artifact 标签，并 SHALL 标注其来自历史回复版本

#### Scenario: 切回旧回复
- **WHEN** 用户从 B 切回 A
- **THEN** Artifact A SHALL 恢复为当前版本资产，原内容和来源信息保持不变

### Requirement: Message 反馈按用户持久化和隔离

点赞或点踩 SHALL 按 owner、tree、thread 与 assistant `messageId` 持久化。反馈读取与写入 SHALL 校验当前登录用户以及消息确实存在于其严格 schema-v2 tree 中；刷新后 SHALL 恢复该 message 的反馈状态。重新生成产生的新 assistant message SHALL 从未反馈状态开始，旧 message 的反馈记录保留但不显示为新答案的反馈。generation 记录不得作为产品反馈的主键或可用性条件。

#### Scenario: 刷新后恢复反馈
- **WHEN** 用户评价一条回复后刷新同一棵树
- **THEN** 系统 SHALL 从服务端恢复该 assistant message 的点赞或点踩状态

#### Scenario: 重新生成不继承反馈
- **WHEN** 已评价的 assistant 消息被重新生成并产生新的 sibling assistant message
- **THEN** 新答案 SHALL 显示未评价状态，旧 message 的反馈不得迁移到新 message

#### Scenario: 越权提交反馈
- **WHEN** 用户尝试读取或修改不属于自己的 tree/message 反馈
- **THEN** 系统 SHALL 拒绝请求且不得泄露目标 tree 或 message 是否存在

#### Scenario: 已完成系统回复具有执行来源
- **WHEN** 服务端读取一条由系统生成且状态为 `done` 的 assistant message
- **THEN** 系统 SHALL 能找到 `assistantMessageId` 指向该 messageId 的 generation 记录；若关联缺失，SHALL 将其视为数据不变量错误而不是可正常反馈的完成消息

### Requirement: 消息操作在列模式与画布模式保持一致

列模式和画布外挂对话面板 SHALL 使用相同的消息操作、版本切换、可用性规则和状态反馈。两种视图中的操作 SHALL 作用于同一个 Thread store、active leaf、generation identity 和服务端 API，不得形成相互独立的复制、编辑、重试、版本或反馈实现。

#### Scenario: 在两种视图之间切换
- **WHEN** 用户在列模式执行复制、编辑、重新生成、版本切换或反馈后切换到画布模式，或反向切换
- **THEN** 另一视图 SHALL 显示同一 active path、消息、generation、来源分支和反馈状态

#### Scenario: 操作过程中的可访问反馈
- **WHEN** 操作按钮仅显示图标或进入 copied、pressed、regenerating 状态
- **THEN** 两种视图 SHALL 提供可读的 accessible name，并以 `aria-pressed`、status 文案或等价语义暴露状态变化
