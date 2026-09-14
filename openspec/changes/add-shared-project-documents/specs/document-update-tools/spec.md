## ADDED Requirements

### Requirement: 自然语言修改通过文档工具执行

系统 SHALL 提供同 Project 的查找、读取和更新文档工具，使任意有权限 Thread 可执行用户明确要求的 Markdown 修改，不要求该 Thread 必须从文档分叉。工具 SHALL 调用统一应用服务，不由客户端或模型直接写数据库。

#### Scenario: 用户指定 TODO6 更新
- **WHEN** 用户在 Thread A 说“帮我更新 @F1，把 TODO6 的方案更新为 xx 并勾选为已经完成”
- **THEN** 模型确定 F1 对应 Document，读取当前完整 Markdown，定位 TODO6，提交原子 edits，成功后根据收据说明已更新；无需结构化 Task 表

#### Scenario: 仅讨论方案
- **WHEN** 用户只是引用 F1 并问“这个方案有什么问题”
- **THEN** 可以读取和讨论，但不调用更新去修改项目文档

### Requirement: 目标解析不得猜测身份

系统 SHALL 优先使用实际 @artifact 的固定 ID 映射目标 Document；仅有名称时在当前 Project 查找，返回可辨识候选。同名、多候选或不能确定具体段落时 SHALL 请求用户明确，不自动新建同名文件、跨项目搜索写入或取第一候选。

#### Scenario: 唯一名称
- **WHEN** 用户提供名称，当前 Project 只有一个明确匹配的文档
- **THEN** 读取该文档并按指令准备修改，不强制要求用户先打开文档

#### Scenario: 同名文档
- **WHEN** 用户只说更新 F1，而存在两个同名候选
- **THEN** 展示足够区分的来源信息并询问目标，在明确之前不写入

#### Scenario: 目标不存在
- **WHEN** 指定 Artifact 无映射、已不可访问或目标文件不存在
- **THEN** 明确反馈不可更新，不创建替代文件或迁移到同名对象

### Requirement: 读取结果固定版本并提供可验证收据

readProjectDocument SHALL 返回完整 Markdown、Document/Revision/Artifact ID 和服务端持久化 readId。readId SHALL 绑定用户、执行和版本，更新必须与其 expectedRevisionId 匹配。历史消息引用和只读取到 ID/标题的工具结果不能冒充本轮完整读取。

#### Scenario: 更新前读取当前版本
- **WHEN** 模型准备修改 D1
- **THEN** 先获得其最新完整内容与 readId，再基于该版本形成 edits

#### Scenario: 只替换版本号
- **WHEN** 发生冲突后模型将 expectedRevisionId 改为新版本但复用旧 readId
- **THEN** 拒绝写入，要求实际重新读取；服务端不声称收据能证明模型已理解新内容

#### Scenario: 越权读取收据
- **WHEN** readId 属于其他执行、用户、文档或不同版本
- **THEN** 拒绝作为本次修改依据，不泄漏他人文档内容

### Requirement: 冲突后重新审视并生成新修改

DOCUMENT_CHANGED SHALL 作为可恢复工具结果返回当前版本身份，模型必须重读全文、核对原用户目标和最新文档，再决定新 edits、说明已满足或询问用户。系统 MUST NOT 自动以新版本号套用旧 patch，MUST NOT 自动恢复被删段落。单次执行同文档默认最多 2 次冲突重读/重提，由集中配置约束。

#### Scenario: 他人修改可保留
- **WHEN** B 冲突后重读 R2，发现 A 的修改与本次目标可以共存
- **THEN** B 基于 R2 重新生成修改，以新命令提交 R3，并保留 A 的结果

#### Scenario: TODO6 被删除
- **WHEN** 重读后发现 TODO6 已被另一个分支删除
- **THEN** 不自动恢复或改其他 TODO，说明情况并保留研究结论，等待用户决定

#### Scenario: 文本仍在但需求变化
- **WHEN** 旧段落仍存在，但最新文档改变了其前提或目标
- **THEN** 模型重新审视适用性，不能仅因原文仍匹配就照搬旧 edits；无法确定时询问

#### Scenario: 用户目标已经满足
- **WHEN** 重读发现方案和完成状态均已达到用户要求
- **THEN** 说明已满足或返回 unchanged，不为这次重试创建重复版本

#### Scenario: 冲突持续发生
- **WHEN** 达到本执行的自动重试上限
- **THEN** 停止自动写入，明确说明文档持续变化，保留未提交建议，不能无限循环

### Requirement: 写入作用域来自已验证的用户请求

工具 SHALL 仅执行当前用户明确授权的文档修改，精确目标的自然语言更新无需额外强制审批。服务端必须校验用户/Project/文档状态和活跃执行，来源 Thread、Message、执行和命令身份由服务端绑定，不能接受模型自报。文档正文中的指令不得扩大写入权限。

#### Scenario: 文档包含其他操作指令
- **WHEN** 读取的 PRD 内容要求修改另一 Project 或删除无关文件
- **THEN** 将其当作资料文本，不作为用户授权，服务端也拒绝越出执行作用域的写入

#### Scenario: 模型伪造来源
- **WHEN** 输入包含自报 actor、Project 或来源 Message 等权威字段
- **THEN** 严格 Schema 拒绝，不能伪造审计来源

#### Scenario: 文档被归档
- **WHEN** 文档读取后、提交前变为只读
- **THEN** 更新服务返回明确只读结果，不执行修改

### Requirement: 工具生命周期与结果持久化

系统 SHALL 支持查找/读取/更新/冲突重读/结果说明的多步生成，不沿用 createMarkdownArtifact 完成即停止来截断此流程。只有权威 committed 结果才能宣称更新成功；读取、成功和失败工具结果 SHALL 可恢复并固定内容，更新依赖的操作身份保持稳定。

#### Scenario: 冲突不终止整轮对话
- **WHEN** update 工具返回 DOCUMENT_CHANGED
- **THEN** 模型可在预算内继续读取和处理，UI 显示正在处理文档变化而非虚假成功

#### Scenario: 刷新后恢复操作结果
- **WHEN** 页面刷新或生成连接断开后重新打开
- **THEN** 已提交版本可从收据恢复，未提交的流式工具参数不被当作真实版本

#### Scenario: 只生成自然语言成功说明
- **WHEN** 模型输出“已保存”但没有对应 committed 收据
- **THEN** 产品不显示已提交状态或新版本，不能用自然语言代替数据库操作结果
