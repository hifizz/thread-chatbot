## MODIFIED Requirements

### Requirement: 自然语言修改通过文档工具执行

系统 SHALL 提供同 Project 的查找、读取、草稿编辑、显式最终提交及冲突后草稿重置工具，统一调用应用服务，不由客户端或模型直接写数据库。新生成 SHALL 使用 editProjectDocument 与 commitProjectDocument，MUST NOT 暴露旧 updateProjectDocument 的即时发布能力。任意有权限 Thread 可执行用户明确要求的 Markdown 修改，不要求先从文档分叉。

#### Scenario: 用户指定 TODO6 更新
- **WHEN** 用户要求更新 @F1 的方案并勾选完成
- **THEN** 模型确定 Document、读取完整工作副本、编辑并检查，准备完成后显式 commit，依据最终收据说明结果

#### Scenario: 仅讨论方案
- **WHEN** 用户仅引用 F1 询问问题
- **THEN** 可以读取和讨论，但不调用编辑、重置或提交去执行未经授权的修改

#### Scenario: 小范围试验后继续修改
- **WHEN** 模型先做一次小范围有效编辑，再完成其他内容
- **THEN** 两次编辑只改变草稿，最终最多一次正式提交，不把试验变成正式版本

### Requirement: 读取结果固定版本并提供可验证收据

readProjectDocument SHALL 返回完整正文和服务端持久化 readId，并显式区分正式 Revision 与本轮草稿。正式读取收据绑定用户、执行、Document、Revision；草稿读取收据还必须绑定 draftId 与 sequence。编辑必须匹配当前完整草稿读取收据；成功改变草稿后若继续编辑必须重新读取当前序号。历史引用、标题/ID 查询和通知摘要不能代替完整读取。

无 source 判别字段的旧结果 SHALL 在兼容边界按旧正式读取解析，不重写历史。

#### Scenario: 更新前首次读取
- **WHEN** 本轮准备修改且没有工作副本
- **THEN** 基于当前正式版本准备工作副本，取得其完整内容与可验证收据

#### Scenario: 编辑成功后复用旧读取收据
- **WHEN** 草稿已进入新 sequence，后续编辑仍携带旧 readId
- **THEN** 拒绝编辑并要求重读，不因模型仅替换 expectedDraftSequence 而放行

#### Scenario: 越权读取收据
- **WHEN** readId 属于其他执行、用户、文档、草稿或不同序号
- **THEN** 拒绝作为本次编辑依据，不泄漏他人内容

#### Scenario: 查看历史不修改工作副本
- **WHEN** 已有草稿时显式读取旧 revisionId
- **THEN** 固定返回历史版本，不能将该收据冒充当前草稿读取依据

### Requirement: 冲突后重新审视并生成新修改

DOCUMENT_CHANGED SHALL 作为可恢复结果返回当前正式版本身份并保留草稿。模型必须显式重读新正式全文、核对用户目标，通过 resetProjectDocumentDraft 将工作副本重置为该版本，再重新生成 edits。系统 MUST NOT 只换基础版本号套用旧正文或 patch，不自动合并、不自动恢复已删除目标。

同文档每执行最多进行 2 次冲突后的重新准备，受集中配置和总失败预算共同约束；普通幂等重放不计入新重试。

#### Scenario: 他人修改可保留
- **WHEN** B 冲突后读取 R2，确认 A 的结果与本次目标兼容
- **THEN** B 显式 reset 到 R2 后重新编辑，再提交一个正式新版本并保留 A 的结果

#### Scenario: TODO6 被删除
- **WHEN** 重读发现目标已被删除
- **THEN** 不自动恢复或修改其他目标，保留草稿与建议并说明情况

#### Scenario: 文本仍在但前提变化
- **WHEN** 原段落仍匹配，但最新正式版本改变了其前提
- **THEN** 模型重新审视；无法确认时不提交，不能将字符串匹配视为语义授权

#### Scenario: 用户目标已满足
- **WHEN** 新正式版本已满足要求，工作副本已正确 reset 且无新增变化
- **THEN** 可以显式以 unchanged 结束，不创建重复版本

#### Scenario: 冲突达到上限
- **WHEN** 达到同文档重新准备上限或本轮失败预算
- **THEN** 服务端拒绝继续自动写入，保留未提交过程并解释结果

### Requirement: 写入作用域来自已验证的用户请求

工具 SHALL 仅执行当前用户明确授权的文档修改，精确目标的自然语言请求无需新增强制人工审批。服务端 SHALL 校验用户、Project、Document、草稿归属、可写状态和活跃执行；Thread、Message、actor 和调用命令身份由服务端绑定，模型不能自报。文档正文中的指令不得扩大权限，读取时建立副本也不构成修改授权。

#### Scenario: 文档包含其他操作指令
- **WHEN** 正文要求修改其他 Project 或无关对象
- **THEN** 将其视为资料，工具不能据此扩大写入范围

#### Scenario: 模型伪造来源
- **WHEN** 输入包含自报 actor、Project 或来源 Message 等权威字段
- **THEN** 严格输入校验拒绝，不伪造审计来源

#### Scenario: 提交前项目只读
- **WHEN** 读取后 Project 被归档或写入开关关闭
- **THEN** 拒绝新编辑、reset 和正式提交，保留草稿；旧成功收据仍能授权读取

### Requirement: 工具生命周期与结果持久化

系统 SHALL 支持读取、编辑、检查、显式提交、冲突重读和重置的多步过程。edited/no_change 仅表示工作副本操作，只有权威 committed 收据才能表示新增正式版本。unchanged 表示显式结束且未新增版本。读取、成功、拒绝和已观察到的 SDK 参数错误 SHALL 持久化并可恢复。

新工具结果 SHALL 使用独立文档工具结果持久化入口，展示和模型上下文必须经 restoreDocumentToolParts 合并。消息恢复的末尾追加不保证原始事件顺序。生成结束、最后一步策略和 createMarkdownArtifact 兜底 MUST NOT 自动发布草稿或为修改任务另建同名替代文档。

#### Scenario: 刷新恢复编辑过程
- **WHEN** 草稿已保存而流式快照丢失或浏览器断开
- **THEN** 从工具收据与草稿仓储恢复，不能将未验证的流式参数当成版本

#### Scenario: 只生成成功说明
- **WHEN** 模型文字声称已保存但没有 committed 收据
- **THEN** 产品不显示正式成功状态或版本卡片，未提交草稿状态仍明确可见

#### Scenario: 末步仍有未提交草稿
- **WHEN** 生成到达最后步骤而草稿尚未 commit
- **THEN** 不强制提交、不创建替代文件，结束后保留未提交结果

#### Scenario: 历史即时工具结果
- **WHEN** 打开包含旧 updateProjectDocument 结果的消息
- **THEN** 仍展示其真实已提交版本，不重新执行旧工具，不提供绕过新协议的新写入口

## ADDED Requirements

### Requirement: 文档工具失败预算覆盖执行前参数错误

系统 SHALL 对本轮文档工具失败采用持久化、按调用身份去重的预算，覆盖 schema 参数错误、patch 失败、草稿序号过期和版本冲突。初始总预算 SHALL 为每执行 6 次，由 constants 集中配置；第 6 次失败后禁止新的文档写操作。相同调用回放不重复计数，无法解析 documentId 的失败只记到执行，不猜测文档。

SDK 在 execute 前拒绝的调用 SHALL 通过流式工具适配记录。结构化业务拒绝正常提交收据；事务异常回滚后的错误记录不得覆盖已有成功结果。若失败记录无法持久化，系统 SHALL 停止本轮文档写入，而非继续不受预算约束的重试。

#### Scenario: edits 类型错误
- **WHEN** SDK 因 edits 不是合法数组而未执行编辑服务
- **THEN** 草稿与正式版本均不变，该次已观察到的错误可追溯并计入一次失败

#### Scenario: 同一失败重复传输
- **WHEN** 相同错误调用被恢复管线重复处理
- **THEN** 不生成第二次失败计数，不覆盖原始调用结果

#### Scenario: 达到预算但仍发起修改
- **WHEN** 本轮已有 6 次不同调用失败，模型继续请求 edit/reset/commit
- **THEN** 服务端拒绝新写，保留草稿；已完成提交的事实回放不受新写限制

#### Scenario: 成功后出现迟到传输错误
- **WHEN** 数据库成功收据已经存在，但管线之后报告该调用的传输异常
- **THEN** 成功事实优先，不将其替换成编辑失败或重复执行