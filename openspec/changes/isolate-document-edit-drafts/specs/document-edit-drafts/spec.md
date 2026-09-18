## ADDED Requirements

### Requirement: 本轮工作副本身份唯一

系统 SHALL 使用服务端绑定的 assistant messageId 与 documentId 唯一标识一次文档修改过程，并持久化其 Project、基础正式版本、工作正文、草稿序号与状态。系统 MUST NOT 以工具调用 ID 或文档标题建立新的同轮工作副本。工作副本 SHALL 与正式 Document/Revision/Artifact 分开，不出现在正式版本目录中。

#### Scenario: 同轮多次读取和编辑
- **WHEN** 同一执行重复读取或编辑同一 Document
- **THEN** 使用同一个 draftId，保持既有工作正文，不新建第二份工作副本

#### Scenario: 不同执行修改同一文档
- **WHEN** 两条 assistant Message 分别准备修改同一 Document
- **THEN** 各自拥有独立草稿，在最终提交时协调正式版本，不互相读取私有工作副本

#### Scenario: 工作副本归属不一致
- **WHEN** 请求混用其他用户、Project、Message 或 Document 的草稿 ID
- **THEN** 服务端拒绝访问或修改，不泄漏对方正文及版本状态

### Requirement: 默认读取本轮工作副本且历史读取不改变基础

readProjectDocument SHALL 在本轮已有工作副本且未指定 revisionId 时返回该副本的完整快照；没有副本且允许准备时，SHALL 基于当时正式 head 建立 sequence 0 副本。显式 revisionId 读取 SHALL 返回固定正式版本，不改变工作副本。只读或写入关闭时 SHALL 保持合法的正式读取能力，不新建可编辑副本。

#### Scenario: 编辑后检查结果
- **WHEN** 模型成功编辑后再次默认读取该文档
- **THEN** 返回最新草稿正文及序号，不返回尚未变化的正式正文冒充编辑结果

#### Scenario: 查看历史版本
- **WHEN** 已有草稿而模型显式读取较早的 revisionId
- **THEN** 返回固定历史正文，现有草稿内容、基础和序号不变

#### Scenario: 只有读取没有修改
- **WHEN** 一轮只建立并读取 sequence 0 副本，随后结束
- **THEN** 不创建正式版本，产品不声称用户有未保存的内容修改

### Requirement: 草稿编辑原子保存检查点

editProjectDocument SHALL 校验活跃执行、写入权限、草稿 editing 状态、expectedDraftSequence 和当前完整读取收据，然后针对一次调用开始时的草稿正文原子应用全部 edits。成功且有变化 SHALL 在同一事务追加完整检查点、更新正文及序号并保存收据。失败 SHALL 保持正文与序号不变；无变化 SHALL 返回 no_change，不生成检查点、不结束草稿。编辑 MUST NOT 创建正式 Artifact/Revision 或推进 head。

#### Scenario: 一项 patch 失败
- **WHEN** 同一编辑调用中一个 oldText 不存在，而其他 edits 可应用
- **THEN** 整次编辑失败，草稿不变，失败结果可追溯

#### Scenario: 两个编辑基于相同序号
- **WHEN** 不同调用并发提交相同 expectedDraftSequence
- **THEN** 最多一个有变化编辑成功，后续调用因序号过期被拒绝

#### Scenario: 重放同一编辑
- **WHEN** 相同 toolCallId 和相同参数再次到达
- **THEN** 回放原结果，不重复应用、不新增检查点、不重复计入预算

### Requirement: 检查点保留准确的局部历史

检查点 SHALL 保存 draftId、单调序号、操作类型、工具调用身份、当时基础版本、edits 和完整正文。检查点 SHALL 只追加；重置不得删除已有历史或复用旧序号。系统 MUST NOT 将不同检查点的 edits 拼接解释为对一个基础正文的一次 patch。

#### Scenario: 编辑两次后重置
- **WHEN** 草稿已经有两条编辑检查点，随后显式 reset
- **THEN** 保留原检查点并追加更大序号的 reset 快照，每条记录仍能解释其原基础

### Requirement: 冲突后的重新准备必须显式重置

resetProjectDocumentDraft SHALL 仅允许当前活跃执行内的 editing 草稿，验证草稿序号及针对新正式版本的完整读取收据。目标 Revision 必须仍是正式 head。重置 SHALL 同时替换基础和工作正文、追加检查点并递增序号；不得仅更换 baseRevisionId，亦不得自动合并旧草稿。

#### Scenario: 重置到已读取的新 head
- **WHEN** 提交发生冲突，模型读取新 head 并显式请求重置
- **THEN** 草稿从新正式正文重新准备，旧工作过程保留，后续 edits 必须重新生成

#### Scenario: 重置之前再次发生更新
- **WHEN** 已读取版本在 reset 前不再是正式 head
- **THEN** 拒绝重置，现有草稿和检查点保持不变，要求重新处理冲突

### Requirement: 草稿终态与生成生命周期协调

草稿 SHALL 使用 editing、committed、unchanged、abandoned 状态。commit 成功进入 committed，最终与基础相同进入 unchanged。Stop 生效、执行失败、被替代、孤儿执行关闭或正常生成结束时，尚未提交的草稿 SHALL 结束为 abandoned 并保留内容。所有终态 MUST NOT 再编辑或重置。流结束、步骤耗尽和自然语言完成说明 MUST NOT 触发自动发布。

#### Scenario: 停止未提交的多次编辑
- **WHEN** 用户 Stop 已在权威消息状态生效，草稿尚未 commit
- **THEN** 保留正文和检查点、关闭草稿、拒绝迟到写入，正式版本不变

#### Scenario: 提交先于停止成功
- **WHEN** commit 事务先完成，Stop 后生效
- **THEN** 保留 committed 草稿及正式版本，不改成未提交，不回滚

#### Scenario: 步骤耗尽
- **WHEN** 模型多次编辑后到达生成步数上限但未显式 commit
- **THEN** 草稿保留且结束，界面明确未正式提交，不产生版本卡片

#### Scenario: 服务进程重启
- **WHEN** 活跃生成被孤儿恢复逻辑标记失败
- **THEN** 同步关闭未提交草稿，不因恢复而发布；已提交收据仍可查看

### Requirement: 草稿和检查点可授权只读恢复

系统 SHALL 提供所有者可访问的草稿摘要、检查点目录和固定快照只读查询；目录不得批量携带全部正文。刷新 SHALL 可恢复本轮进度、草稿和检查点。历史草稿不得作为正式 Artifact 或新的写入执行身份，不提供跨轮继续编辑能力。

#### Scenario: 流式消息快照缺失
- **WHEN** 页面刷新后原工具结果未出现在 messages.parts
- **THEN** 使用独立持久化工具结果恢复操作事实，并从草稿仓储读取真实状态和快照

#### Scenario: 查看已停止的草稿
- **WHEN** 所有者打开 abandoned 草稿的检查点
- **THEN** 可只读查看固定内容，不能在新一轮直接继续修改该草稿

#### Scenario: 检查点排序
- **WHEN** 消息恢复将缺失工具结果追加到消息末尾
- **THEN** 检查点仍按持久化 sequence 展示，不把消息追加顺序解释为真实执行顺序