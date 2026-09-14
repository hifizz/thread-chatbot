## ADDED Requirements

### Requirement: 文档身份独立于固定产物

系统 SHALL 为同一 Project 内持续维护的 Markdown 提供稳定 Document ID，使用 currentRevisionId 指向已提交版本。每个 DocumentRevision SHALL 关联一个固定 Artifact 保存完整标题与正文，旧 Artifact ID、正文及来源 MUST NOT 原地修改。标题 MUST NOT 用作唯一身份。

#### Scenario: 主线创建后分支更新
- **WHEN** 主线 Message M1 创建 Artifact A1，分支 Message M8 更新其对应文档 D1
- **THEN** D1 从 R1 前进到 R2，R2 指向新 Artifact A2；M1 与 A1 仍代表 R1，项目 D1 默认展示 R2

#### Scenario: 同名文件
- **WHEN** 同 Project 有两份同名 Markdown
- **THEN** 保留两个不同 Document ID，不能自动合并版本或以名称猜测写入目标

### Requirement: 初始版本登记与历史兼容

系统 SHALL 在普通新 Markdown Artifact 成功持久化时原子建立其 Document/R1；更新已有文档产生的 Artifact SHALL 加入原 Document 而不是新建文件。旧 completed Markdown SHALL 通过幂等登记映射为各自独立 Document/R1，保留既有引用。未完成和未登记旧产物 MUST NOT 被静默当作可写文件。

#### Scenario: 新文档登记失败
- **WHEN** Artifact、Document 或 R1 登记任一环节失败
- **THEN** 事务不提交半成品可见文档，可通过同一操作恢复，不产生重复文件

#### Scenario: 重复迁移
- **WHEN** 初始版本登记重复执行或中断后恢复
- **THEN** 同一 Artifact 最多映射一个 Revision，不重复建立 Document，不将同名 Artifact 合并

### Requirement: 版本关系与项目隔离

系统 SHALL 保存版本号、parentRevisionId、artifactId、修改说明、edits、用户及真实执行来源。版本号在同文档内唯一递增，parent 与 current 必须属于同一 Document，Document/Artifact/执行来源必须属于同一 Project。Revision 为 append-only；Project 存续时不得单独删改被引用的历史版本。

#### Scenario: 跨文档或跨项目版本
- **WHEN** 请求或数据库写入尝试将其他 Document 的 Revision 设为当前版本，或混用其他 Project 的 Artifact
- **THEN** 拒绝该关系，当前文档保持原状态

#### Scenario: 追溯修改
- **WHEN** 用户查看 R2 的历史信息
- **THEN** 能读取前一版本、完整内容、修改说明及真实来源 Thread/Message；来源消息被替代不改变这些事实

### Requirement: Markdown 多处替换原子应用

系统 SHALL 使用 expectedRevisionId 与一组 oldText/newText edits 更新普通 Markdown。所有 oldText SHALL 非空且在同一原始 Markdown 版本中唯一定位，各范围不得重叠；系统 SHALL 倒序应用所有替换并验证结果大小与非空约束。新 Artifact、Revision、head 和成功收据必须在同一事务提交；不得使用渲染后选区坐标直接修改 Markdown 源码。

#### Scenario: 同时改方案和复选框
- **WHEN** 一次请求修改 TODO6 的方案文字，并将其复选框从未完成改为完成
- **THEN** 两处修改共同产生一个新 Revision，任意一处失败则都不保存

#### Scenario: 部分原文不存在
- **WHEN** 多个 edits 中一项 oldText 无法定位
- **THEN** 返回 SOURCE_NOT_FOUND，整个操作不新增 Artifact/Revision、不推进 head

#### Scenario: 重复原文或重叠范围
- **WHEN** oldText 多次出现或两个 edits 的原始范围重叠
- **THEN** 返回 SOURCE_AMBIGUOUS 或 OVERLAPPING_EDITS，不默认选择首处，不部分应用

#### Scenario: 增删段落
- **WHEN** 合法修改用空 newText 删除一段，或将原段替换为原段加新内容
- **THEN** 使用同一原子协议应用，结果仍满足完整 Markdown 限制

#### Scenario: 结果未变化
- **WHEN** 所有替换后的文档与原版本完全相同
- **THEN** 返回 unchanged 并保存幂等结果，不新增相同内容版本、不发送虚假修改进展

### Requirement: 同文档提交串行且严格检查版本

系统 SHALL 允许不同 Thread 同时讨论和生成修改，只在同一文档的短数据库事务中协调写入。持锁期间 MUST NOT 调用模型或等待网络。所有会改变 head/可写状态的操作必须遵守统一协调规则；head 与 expectedRevisionId 不符时 SHALL 返回 DOCUMENT_CHANGED，不进行自动合并，即使文本范围不同。

#### Scenario: 两个分支同时基于 R1 修改不同段落
- **WHEN** A、B 都读取 R1，A 先提交 R2，B 随后提交
- **THEN** A 成功，B 返回当前 R2 和需要重读的冲突信息，A 的结果不被覆盖

#### Scenario: 同时更新不同文档
- **WHEN** A 更新 D1、B 更新 D2
- **THEN** 不因本能力新增全项目长时间排队，分别按各自文档事务提交

#### Scenario: 提交前文档只读
- **WHEN** 文档或 Project 在更新提交之前进入不可写状态
- **THEN** 权威事务拒绝更新，不仅依靠先前读取时的状态

### Requirement: 幂等提交依据操作身份

系统 SHALL 将命令 ID 与用户、文档、真实执行及 requestHash 绑定。成功或 unchanged 后相同命令相同请求重试必须回放原结果；回放判断先于 head 冲突判断。同 ID 不同请求必须拒绝。重读后重新生成的修改必须使用新的命令身份。

#### Scenario: 提交成功但响应丢失
- **WHEN** R2 已提交，客户端重试时文档已进一步变成 R3
- **THEN** 原命令仍返回其 R2 成功结果，不误报冲突，不重复产生版本

#### Scenario: 同 ID 替换内容
- **WHEN** 重试使用同 commandId 却改变 expectedRevisionId 或 edits
- **THEN** 返回命令冲突，不能将它当作新更新执行

### Requirement: 已提交修改独立于回复终态

系统 SHALL 以数据库版本提交和收据确认修改成功，不以整条 assistant Message 是否 completed 判断。Stop、重生、消息编辑或流断开 MUST NOT 自动撤销已提交版本。活跃执行状态与提交 SHALL 协调确定先后，禁止 Stop 已生效后再执行未提交的写入。

#### Scenario: 提交后回复失败
- **WHEN** 文档已生成 R2，但后续模型说明失败或用户停止回复
- **THEN** R2 保留且可通过文档历史/工具收据查到，UI 显示已提交事实，不声称整笔操作未发生

#### Scenario: 停止先完成
- **WHEN** Stop 已在权威执行状态生效，而工具尚未提交
- **THEN** 不新增文档版本；提交与 Stop 竞争时按事务实际先后处理

#### Scenario: 生成最终化重复收集产物
- **WHEN** 工具已提交 A2/R2，生成最终化或恢复再次处理该结果
- **THEN** 复用已提交对象，不复制新的 Artifact/Document，不删除 A2

### Requirement: 当前与历史读取具有不同语义

系统 SHALL 支持按 Document 读取当前版本、按 Revision/Artifact 读取固定历史。历史引用、Quote、Fork 和分享快照 MUST NOT 自动追随 head。恢复旧内容必须成为新的明确修改，不能倒退或删除已提交历史。

#### Scenario: 从旧 Artifact 要求更新
- **WHEN** 用户在消息中引用旧 A1 并明确说更新该文件，而 D1 当前为 R3
- **THEN** 旧引用仍表示 A1；写工具解析 A1 对应 D1，并读取 R3 后准备新修改

#### Scenario: 分享后文件更新
- **WHEN** 分享冻结 R1 后内部文档更新到 R2
- **THEN** 分享仍展示 R1，不开放写入、不动态展开 R2
