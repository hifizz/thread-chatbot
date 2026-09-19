## MODIFIED Requirements

### Requirement: 版本关系与项目隔离

系统 SHALL 保存正式版本号、parentRevisionId、artifactId、修改说明、用户及真实执行来源。版本号在同文档内唯一递增，parent 与 current 必须属于同一 Document，Document/Artifact/执行来源必须属于同一 Project。Revision SHALL 保持 append-only；Project 存续时不得单独删改被引用的历史版本。

新草稿协议生成的 Revision SHALL 通过唯一 sourceDraftId 关联本轮操作历史，逐步 edits 以检查点为权威来源；不得将不同中间正文上的 edits 拼成一次基础版本 patch。新协议 Revision.edits SHALL 使用空数组并由 sourceDraftId 标识审计语义；旧 Revision.edits 和既有来源信息 SHALL 原样保留。

#### Scenario: 跨文档或跨项目版本
- **WHEN** 写入尝试将其他 Document 的 Revision 设为当前版本，或混用其他 Project 的 Artifact 或草稿
- **THEN** 拒绝该关系，当前文档保持原状态

#### Scenario: 追溯草稿提交
- **WHEN** 用户查看经多次草稿编辑提交的 R2
- **THEN** 能读取固定正文、父版本、修改说明和真实来源，并经 sourceDraftId 查看逐步操作；不得把空 Revision.edits 解释成没有修改

#### Scenario: 查看旧协议版本
- **WHEN** 历史 Revision 没有 sourceDraftId
- **THEN** 按旧数据读取原 edits、Artifact 和来源，不迁移或推造草稿历史

### Requirement: Markdown 多处替换原子应用

系统 SHALL 在草稿编辑阶段使用 expectedDraftSequence 和当前完整读取收据应用一组 oldText/newText edits。所有 oldText SHALL 非空且在该次调用开始时的同一草稿正文中唯一定位，各范围不得重叠；系统 SHALL 倒序应用全部替换并验证正文大小与非空约束。任意一项失败必须使整次草稿编辑无正文副作用。

草稿编辑 MUST NOT 创建正式版本。显式最终提交 SHALL 校验基础正式版本，并在同一事务创建新 Artifact、Revision、推进 head、结束草稿和保存收据。不得使用渲染后选区坐标直接修改 Markdown 源码。

#### Scenario: 同时改方案和复选框
- **WHEN** 一次编辑同时修改 TODO6 方案和复选框
- **THEN** 两处共同进入一个检查点；任一处失败则都不改变草稿，最终显式提交才发布正式版本

#### Scenario: 部分原文不存在
- **WHEN** 多个 edits 中一项 oldText 无法定位
- **THEN** 返回 SOURCE_NOT_FOUND，草稿不变，不新增 Artifact/Revision、不推进 head

#### Scenario: 重复原文或重叠范围
- **WHEN** oldText 多次出现或两个范围重叠
- **THEN** 返回 SOURCE_AMBIGUOUS 或 OVERLAPPING_EDITS，不选择首处、不部分应用

#### Scenario: 增删段落
- **WHEN** 合法编辑用空 newText 删除一段，或把原段替换为原段加新内容
- **THEN** 使用同一草稿原子协议，结果仍满足 Markdown 限制

#### Scenario: 一次编辑无变化
- **WHEN** 替换后的正文与当前草稿完全相同
- **THEN** 返回 no_change 并保存调用收据，不增加序号和检查点，草稿仍可继续准备

#### Scenario: 修改后改回基础内容
- **WHEN** 多次编辑后最终正文与基础正文完全相同且正式 head 未变化
- **THEN** 显式 commit 返回 unchanged 并结束草稿，不新增版本

### Requirement: 同文档提交串行且严格检查版本

系统 SHALL 允许不同 Thread 并行讨论和准备各自草稿，只在短数据库事务中协调。持锁期间 MUST NOT 调用模型或等待网络。所有改变 head、执行资格或可写状态的操作 SHALL 遵守统一锁协议。最终提交必须检查正式 head 与草稿 baseRevisionId 相同，否则返回 DOCUMENT_CHANGED，即使文本范围不同也不自动合并。

#### Scenario: 两个分支基于 R1 修改不同段落
- **WHEN** A、B 分别准备草稿，A 先提交 R2，B 随后提交
- **THEN** A 成功，B 返回当前 R2 及冲突信息，保留 B 草稿，不覆盖 A

#### Scenario: 同时更新不同文档
- **WHEN** 两个执行分别更新 D1 和 D2
- **THEN** 不新增全项目排他长锁或任务队列；除既有会话协调外按各自文档独立提交

#### Scenario: 提交前变为只读
- **WHEN** Project 在正式提交前进入不可写状态
- **THEN** 权威事务拒绝新提交，不依赖读取时状态；已成功结果仍可授权回放

#### Scenario: 无变化草稿遇到新 head
- **WHEN** 草稿正文等于旧基础，但正式 head 已推进
- **THEN** 先返回冲突，不宣称当前正式内容无需修改

### Requirement: 幂等提交依据操作身份

系统 SHALL 分离调用级幂等与草稿级正式提交唯一性。调用命令绑定用户、执行、文档、工具调用及 requestHash；同调用同参数回放原结果，同调用不同参数拒绝。重读、重置或修正参数后的新操作必须使用新调用身份。

草稿 SHALL 对 messageId/documentId 唯一，正式 Revision SHALL 对非空 sourceDraftId 唯一。不同工具调用提交同一已完成草稿必须返回相同最终收据，不创建第二个版本。权限校验必须先于回放；回放已完成事实先于新提交的活跃执行和 head 检查。

#### Scenario: 成功响应丢失后更换调用 ID
- **WHEN** 草稿已提交 R2，模型用新 toolCallId 再次提交同一草稿
- **THEN** 返回 R2 的原最终收据，不产生 R3，即使正式 head 已进一步推进

#### Scenario: 同调用替换内容
- **WHEN** 同 toolCallId 被用于不同草稿序号或其他不同参数
- **THEN** 返回命令身份冲突，不当作新操作

#### Scenario: 并发最终提交
- **WHEN** 两个不同调用同时提交同一草稿
- **THEN** 最多创建一个 Artifact/Revision，另一调用返回相同最终结果

#### Scenario: 失败后重新准备
- **WHEN** 首次提交冲突，模型重读并 reset、编辑后以新调用提交
- **THEN** 执行新的有效校验，不永久回放第一次失败

### Requirement: 已提交修改独立于回复终态

系统 SHALL 仅以显式 commit 的数据库事务及收据确认正式修改。Stop、重生、消息编辑、流断开和回复失败 MUST NOT 自动撤销已经提交的版本。Stop 生效后不得执行尚未发生的新写入；执行活跃判断必须包括 stopRequestedAt 与 supersededAt，不只检查 generating。

尚未显式提交的草稿 SHALL 在终态保留但不发布。finalize、孤儿恢复和产物收集 MUST NOT 代替 commit，也不得重复创建已提交产物。

#### Scenario: 提交后回复失败
- **WHEN** R2 已提交，后续模型说明失败或用户停止回复
- **THEN** R2 保留，工具结果和版本历史显示已提交事实

#### Scenario: 停止先完成
- **WHEN** Stop 已设置权威停止标记，而消息暂仍为 generating
- **THEN** 新提交被拒绝，正式版本不变，草稿保留

#### Scenario: 最终化重复处理
- **WHEN** 工具已提交 A2/R2，最终化或刷新再次处理该结果
- **THEN** 复用既有对象，不复制 Artifact/Document，不删除 A2

#### Scenario: 回复正常结束但没有提交
- **WHEN** 草稿有实际编辑，模型直接结束回复而未调用 commit
- **THEN** 关闭并保留未提交草稿，不新增版本，不把回复 completed 解释为文档已保存