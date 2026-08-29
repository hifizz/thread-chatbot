# ThreadChat Project 长期工作空间调研报告

> 调研日期：2026-08-30  
> 代码基线：`codex/feat-agent-observability-evaluation`  
> 基线提交：`48483101ad11bc84b611b615f423577633fedacb`（`fix(evals): enforce exact mode manifests`）  
> 文档性质：Research 阶段结论，供后续 Spec 阶段消费；本文不定义最终数据库字段、接口参数或页面组件。

## 0. 30 秒结论

ThreadChat 的 Project 不应只是“若干聊天加一组公共文件”，而应成为一个能够长期推进工作的 AI 工作空间。推荐的核心模型是：

```text
当前权威状态
+ 不可变版本
+ 显式引用
+ 语义操作记录
+ 可发布的 Thread 阶段结论
+ 分层记忆
```

最重要的决策如下：

1. **不采用完整 Event Sourcing。** 继续用正常业务表保存当前状态，同时为 Contract、File、Artifact 等关键资源建立不可变版本，并增加只追加的 Project Operation 记录。
2. **Operation 不是 Memory。** Operation 回答“发生了什么”；Memory 回答“未来应继续影响 Agent 的事实或偏好”；Contract 回答“这个 Project 必须遵守什么目标和规则”。
3. **EventSource 只负责实时传输。** 浏览器通过 SSE/EventSource 接收活动，不能替代服务端持久化，也不能让 LLM 自动知道用户操作。LLM 必须通过受控上下文或工具读取相关活动摘要。
4. **原始 File Version 不被 Agent 原地覆盖。** 用户更新文件时增加新版本；Agent 改写原始资料时，通常生成派生 Artifact。
5. **Artifact 使用“稳定身份 + 不可变 Revision + 当前 Head”。** 修改产生新 Revision；提交时校验预期 Head，避免两个 Thread 静默覆盖彼此。
6. **跨 Thread 传播必须显式发生。** `@Thread`、`@File`、`@Artifact` 绑定明确版本或阶段快照；来源更新后显示“已有新版本”，不会自动改变历史上下文。
7. **五条研究支线汇总回主线时，默认消费各支线发布的阶段快照。** 汇总结果保留每条来源的版本、更新时间、冲突和未解决问题。
8. **Memory 采用候选—确认—生效流程。** Agent 可以提出 Memory Candidate，但未经用户确认或明确授权，不自动变成 Project Pinned Memory。
9. **Project 评测必须断言状态和副作用。** 不能只判断回答文字是否正确，还要验证版本是否正确、原件是否未被覆盖、引用是否固定、冲突是否被发现、跨 Project 是否无泄漏。

本轮明确不研究 Prompt Cache、Provider Cache、缓存命中率和缓存成本优化。

---

## 一、问题空间与成功标准

### 1.1 用户目标

用户需要在一个 Project 中完成长期、非线性的工作：

- 建立项目目标、工作规则和已确认事实；
- 上传原始资料并持续补充新版本；
- 在对话中生成 Markdown、代码、报告等长期产物；
- 从主线分叉多个研究 Thread；
- 让支线之间显式引用、交叉验证；
- 最后将多个支线可靠汇总回主线；
- 让 Agent 知道当前权威状态和最近的相关变化；
- 避免文件被静默覆盖、历史引用漂移和不同 Thread 相互污染。

### 1.2 工程目标

Project 需要形成六类能力：

```text
Project
├── Contract
│   ├── Target
│   ├── Instructions
│   └── Pinned Memory
├── Assets
│   ├── Files
│   └── Artifacts
├── Threads
│   ├── Fork
│   ├── Reference
│   ├── Published Snapshot
│   └── Convergence
├── Activity
│   ├── Domain Operations
│   └── Agent-facing Activity Summary
├── Memory
│   ├── Project / Thread / Working
│   └── Candidate / Active / Superseded
└── Agent Access
    ├── Read
    ├── Create
    ├── Revise
    ├── Reference
    └── Publish / Promote
```

### 1.3 成功标准

1. 任意持久化操作都能明确回答：谁在何时对哪个对象的哪个版本做了什么。
2. 任意 Artifact 或结论都能追溯到来源 Thread、Message、File/Artifact 版本。
3. B1 的变化不会静默改变 B2；传播只通过显式引用、刷新、发布或汇总发生。
4. 主线能够同时汇总五条支线，并保留来源、冲突、过期状态和未解决问题。
5. Agent 主要读取当前权威状态和任务相关增量，而不是整个 Project 的原始日志。
6. Operation、Memory、Contract、Thread Summary 各自承担清晰职责，不相互替代。

---

## 二、当前代码基线与 Gap

### 2.1 可复用基础

当前分支已经具备以下基础，不需要推翻重做：

- `projects`、`threads`、`messages` 已规范化保存；Project 不再以整棵树 JSON 作为唯一状态。
- Fork 使用 `forkContext` 冻结来源消息，并校验来源是否仍在当前时间线。
- 写命令具有 `commandId`，`executeIdempotentCommand` 能避免同一请求重复执行。
- Attachment 已有上传状态、类型、大小和 PDF 内容处理。
- Artifact 已能由模型工具创建，并关联 `projectId` 与 `sourceMessageId`。
- `compileModelContext` 已是统一的模型上下文编译入口。
- 当前 Agent Evaluation 已包含同 Thread 事实、更正、长上下文、冻结分支和跨 Project 不泄漏等场景。

这意味着 Project 应沿着现有的 Domain Command、规范化状态和统一上下文编译边界扩展，而不是另建一套平行聊天系统。

### 2.2 主要差距

| 目标能力 | 当前状态 | 主要差距 | 风险 |
|---|---|---|---|
| Project Contract | Project 主要只有标题、归档和时间字段 | 没有 Target、Instructions、Pinned Memory 及版本语义 | 高 |
| Project File | Attachment 更接近消息附件 | 缺少逻辑 File、版本、替换、归档、派生和引用语义 | 高 |
| Artifact | 单条记录直接保存内容 | 缺少稳定身份、Revision、Head、Fork、Revert、并发冲突 | 高 |
| Operation | 有幂等 Command Receipt | Receipt 不是面向用户和 Agent 的领域活动记录 | 高 |
| 跨 Thread 引用 | 有 Fork 和 Quote | 没有一等 `@Thread/@File/@Artifact` Reference | 高 |
| 支线汇总 | 可以创建多个 Fork | 没有阶段快照、可汇总状态、来源包和冲突模型 | 高 |
| Memory | 评测中已有“记住事实”的概念 | 尚无 Project Memory 领域对象、确认流程和作用域 | 中高 |
| Agent 上下文 | 主要由冻结消息、当前 Thread、Attachment、Quote 组成 | 尚未选择性装配 Contract、Reference、Memory、Activity | 高 |
| Evaluation | 以回答文本和运行终态为主 | 缺少资源状态、版本和副作用断言 | 中高 |

---

## 三、外部产品基准

### 3.1 Claude Projects

Claude Projects 的长处是：

- Project Instructions 与 Project Knowledge 作为项目级上下文；
- 项目文件可以在多个聊天中复用；
- Artifacts 能把独立产物从聊天正文中分离出来；
- 项目内容超过上下文窗口后使用 RAG 检索。

它暴露出的设计问题也很明确：

- Project Knowledge、聊天历史、Artifact 和 Memory 的边界对普通用户不够直观；
- Artifact 更接近聊天内产物，版本和跨聊天协作语义不够强；
- 多条聊天如何形成正式、可追踪的阶段成果，缺少显式工作流；
- 项目级共享知识容易被用户理解成“模型自动知道项目里的一切”。

ThreadChat 不应简单复制“共享文件 + Instructions”，而应利用自身分支结构，把引用和汇总做成一等能力。

### 3.2 ChatGPT Projects

ChatGPT Projects 的优势是把 Project Memory 与项目内聊天历史联系得更紧，用户在同一 Project 中开启新聊天时，系统能够引用项目内的其他对话和文件。

这种体验自然，但存在一个工程风险：如果“引用过去聊天”没有显式来源、版本和范围，用户很难知道某个回答究竟受哪些旧对话影响。ThreadChat 应保留这种连续感，同时增加可见来源和显式固定版本。

### 3.3 Perplexity Spaces、NotebookLM、Notion

这些产品提供了三个值得借鉴的方向：

- Perplexity Spaces：把共享搜索、文件和协作组织到一个主题空间中。
- NotebookLM：强调回答基于指定来源；外部来源变化时需要显式重新同步，而不是静默变化。
- Notion Enterprise Search：强调可选择的来源范围、引用和权限边界。

共同启示是：**来源范围必须可见，更新传播必须可控。**

### 3.4 差异化机会

ThreadChat 最有价值的差异不是“也支持 Project 文件”，而是：

```text
一条主线
→ 基于具体段落分叉多条支线
→ 每条支线形成可发布的阶段结论
→ 支线之间显式引用
→ 主线按明确版本汇总
→ 用户可追踪每项结论来自哪里
```

这是普通线性聊天 Project 最难自然表达的工作模式。

---

## 四、推荐的总体机制

### 4.1 五类不同对象

| 对象 | 回答的问题 | 示例 |
|---|---|---|
| Current State | 现在是什么 | Artifact 当前 Head 是 Revision 4 |
| Revision / Version | 当时是什么 | Revision 2 的内容和来源 |
| Operation | 发生了什么 | 用户将 Head 从 Revision 3 更新到 Revision 4 |
| Memory | 未来应继续影响 Agent 的什么 | 项目决定所有公开 API 使用 REST |
| Contract | Agent 必须遵守什么 | 不允许静默覆盖原始资料 |

如果把这些概念混在一起，会出现两类错误：

- 把所有历史操作都塞给模型，导致噪声、旧状态竞争和成本持续增长；
- 只保存最终状态，导致来源、修改原因和并发冲突无法解释。

### 4.2 推荐组合

```text
权威状态表
    保存逻辑对象及其当前 Head

不可变版本表
    保存 Contract、File、Artifact、Thread Snapshot 的历史内容

显式 Reference
    保存引用对象、固定版本、创建来源和刷新关系

Project Operation Ledger
    保存有业务意义的操作，不作为状态唯一来源

Activity Summary
    从 Operation 中筛选与当前任务相关的近期变化

Memory
    保存经确认、未来应继续影响 Agent 的语义事实
```

### 4.3 为什么不采用完整 Event Sourcing

完整 Event Sourcing 要求当前状态主要由历史事件重放得到，并引入事件版本迁移、顺序、快照、重建、最终一致性和历史兼容等长期成本。

ThreadChat 当前真正需要的是：

- 不可变历史；
- 资源来源追踪；
- 并发修改检测；
- 用户可见活动；
- Agent 能读取近期相关变化；
- 必要时恢复旧版本。

这些目标使用“正常状态 + 不可变版本 + 只追加操作记录”即可满足。完整 Event Sourcing 会扩大实现面，但不会显著改善首版用户价值。

---

## 五、Project Contract

### 5.1 职责边界

Contract 在产品上由三部分组成：

| 部分 | 作用 | 典型内容 |
|---|---|---|
| Target | 定义当前 Project 要达成什么 | “完成一份可提交投资委员会的研究 Memo” |
| Instructions | 定义工作方式和约束 | “所有结论必须保留来源；不要修改原始文件” |
| Pinned Memory | 保存用户确认的重要事实或决策 | “估值口径统一使用投后估值” |

Pinned Memory 可以在 UI 上和 Contract 放在同一区域，但底层不应等同于 Instructions：

- Instructions 具有规范性，告诉 Agent 应该怎么做；
- Memory 具有事实性，告诉 Agent 已经确认了什么。

### 5.2 版本策略

推荐 Contract 整体拥有版本历史，并允许查看每次修改的差异和操作人。原因是 Target、Instructions、Pinned Memory 共同定义 Project 的工作环境；后续需要回答“某个 Thread 当时遵循哪个 Contract”。

但三个区域在 Spec 阶段仍可采用独立编辑入口，避免用户为了新增一条 Memory 而重写整个 Contract。

### 5.3 对既有 Thread 的影响

Contract 更新后：

- 新一轮模型调用读取当前 Contract；
- 已经生成的消息和已发布的 Thread Snapshot 不被改写；
- 高风险情况下，可记录某次生成使用的 Contract Version，便于复现；
- 如果更新使某个旧结论失效，系统提示“该结论基于旧 Contract”，而不是静默重算。

---

## 六、Project Files

### 6.1 File 不是单次上传记录

推荐区分：

```text
File
    用户理解的稳定资源，例如“2026 年预算.xlsx”

File Version
    某次上传的不可变二进制及其解析结果
```

Attachment 可以继续承担上传和消息引用，但成为 Project 长期资产后，应归属一个稳定 File 身份。

### 6.2 更新、替换与另存为

建议产品语义：

- **上传新版本**：在同一 File 下增加 File Version，并更新当前版本。
- **另存为新文件**：创建新的 File 身份。
- **移出 Project**：不再作为项目资产参与检索，但可保留历史引用。
- **归档**：不在常用列表展示，历史引用仍有效。
- **永久删除**：高风险操作；如果存在历史引用，需明确告知影响或先执行保留策略。

### 6.3 Agent 对原始文件的操作

默认规则：

```text
Agent 不原地修改用户上传的 File Version。
```

当用户说“把这份 PDF 改写成更简洁的版本”时，合理结果是创建一个 Derived Artifact，而不是改写 PDF 原件。

只有用户明确要求“将新版本作为这个逻辑 File 的当前版本”，并且系统支持对应格式的安全写入时，才增加新的 File Version。

### 6.4 引用策略

历史 Thread 对 File 的引用绑定明确 File Version。File 有新版本后：

- 旧 Thread 仍使用原版本；
- UI 标记“该 File 已有新版本”；
- 用户可显式刷新引用；
- 刷新操作产生新的 Reference 或 Reference Revision，不重写历史消息。

---

## 七、Artifact 生命周期

### 7.1 推荐模型

```text
Artifact
    稳定逻辑身份：标题、类型、当前 Head、归档状态

Artifact Revision
    不可变内容：正文、语言、来源、父 Revision、创建者、时间
```

Markdown、HTML、CSS、JS、TS 和普通 Note 可以共享同一生命周期；格式差异主要体现在内容类型、渲染器和验证器，而不是每种格式各自建立版本系统。

### 7.2 Create、Revise、Fork、Revert

| 动作 | 语义 |
|---|---|
| Create | 创建 Artifact 和首个 Revision |
| Revise | 基于当前或指定 Revision 生成新 Revision，并尝试更新 Head |
| Fork | 从指定 Revision 创建新的 Artifact 身份 |
| Revert | 创建一个内容等同于旧 Revision 的新 Revision，并将其设为 Head |
| Archive | 隐藏 Artifact，但保留历史和引用 |

Revert 不应直接把 Head 指针悄悄拨回旧版本；创建新的恢复 Revision 更容易保留操作历史。

### 7.3 并发修改

两个 Thread 同时修改同一 Artifact 时，不能采用“最后一次写入获胜”。推荐使用 Expected Head：

```text
B1 读取 Revision 3
B2 读取 Revision 3
B1 提交 Revision 4，Head = 4
B2 提交时仍声明 expectedHead = 3
系统发现当前 Head 已是 4
→ 拒绝静默覆盖
→ 提供重新基于 4 修改、Fork 或人工合并
```

这类条件写入与 Git 的 compare-and-swap 思路一致，能够把冲突暴露在提交边界。

### 7.4 来源追踪

每个 Artifact Revision 至少应能追溯：

- 创建它的 Project；
- 来源 Thread；
- 来源 Message 或 Agent Run；
- 父 Artifact Revision；
- 使用的 File Version、Artifact Revision、Thread Snapshot；
- 创建者是用户还是 Agent；
- 所依据的 Contract Version。

具体字段属于 Spec 阶段，但 Research 阶段确认：**来源追踪是 Revision 的属性，而不只是 Artifact 的属性。**

---

## 八、Project Operation 与 Activity

### 8.1 为什么 Command Receipt 不够

现有 `conversation_commands` 适合解决写请求幂等：相同 `commandId` 和相同内容可以重放，相同 `commandId` 被用于不同命令时拒绝。

但它不等同于 Project Operation：

- Receipt 面向请求执行；
- Operation 面向领域事实和用户理解；
- Receipt 可以因内部实现变化而变化；
- Operation 应使用稳定的业务语义。

两者应保持分离，但可以在同一事务中写入，使业务状态、Receipt 和 Operation 原子提交。

### 8.2 应记录的操作

首版建议记录：

```text
contract.revised
file.created
file.version_added
file.archived
artifact.created
artifact.revised
artifact.forked
artifact.reverted
artifact.archived
reference.created
reference.refreshed
thread.snapshot_published
convergence.created
memory.candidate_created
memory.promoted
memory.superseded
write.conflict_detected
```

### 8.3 不应进入领域操作记录的行为

- 打开 Tab；
- 鼠标悬停；
- 滚动位置；
- 尚未提交的输入框内容；
- 本地展开或折叠；
- 只发生文本选择但没有创建 Fork/Reference。

这些最多属于产品 Telemetry。只有产生业务状态变化的行为才进入 Project Operation。

### 8.4 EventSource 的正确位置

推荐链路：

```text
用户或 Agent 执行命令
→ 服务端事务提交权威状态、Revision、Operation
→ 服务端通过 SSE 发布轻量通知
→ 浏览器 EventSource 接收并更新界面
```

EventSource 解决的是“浏览器如何及时知道服务器有变化”。它不负责长期保存、不保证 Agent 已知晓，也不能作为唯一事实来源。

### 8.5 Agent 如何知道最近操作

LLM 不应自动接收整个 Operation Ledger。推荐提供两个受控入口：

1. 上下文编译器按任务需要加入一小段“近期相关变化摘要”；
2. Agent 在需要检查更新、冲突或来源时调用 Activity 工具。

示例：

```text
- Thread B3 发布了新的阶段总结 Snapshot 5。
- Artifact“数据模型”已从 Revision 2 更新至 Revision 3。
- 当前 Thread 仍引用 Revision 2。
```

这个摘要是从 Operation 和当前状态计算出的任务视图，不是 Memory。

---

## 九、Operation 与 Memory 的边界

### 9.1 三者关系

```text
Operation：发生了什么
Memory：未来应该记住什么
Contract：未来必须遵守什么
```

例如：

```text
Operation
用户将“架构方案”更新为 Revision 4。

可能的 Memory Candidate
项目已经决定 Artifact 采用不可变 Revision。

Pinned Memory
用户确认：后续所有正式 Artifact 必须保留历史版本。

Instruction
Agent 修改正式 Artifact 前必须显示差异，并禁止静默覆盖。
```

### 9.2 推荐的记忆流程

```text
对话、Artifact 或 Operation 中出现潜在长期事实
→ Agent 或规则创建 Memory Candidate
→ 用户确认，或命中已明确授权的策略
→ Active / Pinned Memory
→ 后续被新事实替代时标记 Superseded
```

### 9.3 本轮建议的记忆层级

| 层级 | 作用域 | 说明 |
|---|---|---|
| Personal Memory | 用户级 | 跨 Project 的稳定偏好；本轮不细化 |
| Project Pinned Memory | Project | 用户明确确认的重要事实、口径、决策 |
| Project Working Memory | Project | 可更新的工作状态，不保证永久有效 |
| Project Decisions / Knowledge | Project | 已形成来源的正式结论，可由 Artifact 或 Snapshot 支撑 |
| Thread Memory | Thread | 只影响本支线的阶段事实和局部假设 |
| Current Working Context | 单次生成 | 当前消息、显式引用、临时选择，不持久化为 Memory |

Operation/Activity 不作为 Memory 层级；它们可以成为产生 Memory Candidate 的证据。

---

## 十、跨 Thread 引用与汇总

### 10.1 Reference 必须是一等对象

仅把 `@B1` 展开成一段文本会丢失来源和版本。Reference 至少要表达：

```text
引用者：当前 Thread / Message / Artifact Revision
被引用对象：Thread / File / Artifact / Memory
固定版本：Thread Snapshot / File Version / Artifact Revision
创建时间与创建者
引用目的或选区
是否已有更新
刷新后指向哪个新版本
```

### 10.2 `@Thread` 的默认含义

不建议默认把整个 Thread 原始历史全部塞入上下文。推荐解析顺序：

1. 若用户指定某条消息或选区，引用该明确内容；
2. 若 Thread 已发布阶段 Snapshot，默认引用最新已发布 Snapshot；
3. 若没有 Snapshot，提示用户先生成/发布总结，或临时生成一个明确标记的摘要；
4. 只有用户明确要求审查全过程时，才读取更大范围的原始历史。

Thread Snapshot 是可引用的阶段成果，不等同于 Memory；它保留本支线当时的结论、证据、假设、冲突和未解决问题。

### 10.3 支线变化如何传播

```text
B1 发布 Snapshot 2
A 引用 Snapshot 2
B1 后续发布 Snapshot 3
A 仍保留 Snapshot 2
系统显示“B1 已有新 Snapshot”
用户选择刷新后，A 创建对 Snapshot 3 的新引用
```

不自动刷新，是为了保证历史可重现并避免支线悄悄改变其他 Thread 的回答。

### 10.4 五条支线汇总的默认流程

假设主线 A 分出 B1—B5：

```text
B1—B5 分别研究
→ 每条支线发布一个阶段 Snapshot
→ A 创建 Convergence Bundle
→ Bundle 固定五个 Snapshot ID
→ Agent 读取五份结构化阶段结论
→ 标识共识、冲突、证据缺口和过期来源
→ 生成主线总结或新的 Artifact Revision
→ 结果保留对五个来源 Snapshot 的追踪
```

Convergence Bundle 的价值是让“这次汇总究竟用了哪些版本”成为显式事实。用户也可以直接 `@B1 @B2 ...`，系统在后台把它们解析成同一组固定 Snapshot。

### 10.5 `@Thread` 与总结 Artifact 的关系

两条路径都应支持：

- `@Thread`：适合探索中、尚未形成正式文档的支线；默认读取已发布 Snapshot。
- `@Artifact`：适合已经形成正式成果的支线；引用明确 Artifact Revision。

普通用户默认使用 `@Thread` 更自然；正式交付、审计和反复修改时，Artifact Revision 更稳定。二者最终都通过统一 Reference 机制进入上下文。

---

## 十一、Agent 资源访问与可预测行为

### 11.1 读取策略

Agent 默认可以读取：

- 当前 Project Contract；
- 当前 Thread 及冻结继承上下文；
- 用户本轮显式 `@` 的资源；
- 与本轮任务直接相关的 Pinned Memory；
- 为检查冲突所需的资源当前 Head 和相关 Activity。

Agent 不应无差别读取整个 Project 的所有文件、聊天、Artifact 和操作历史。

### 11.2 操作权限矩阵

| 操作 | 默认策略 |
|---|---|
| 读取显式引用资源 | 直接允许 |
| 创建新的 Artifact | 明确请求时允许，完成后清楚反馈 |
| 基于 Artifact 创建新 Revision | 显示目标 Artifact、父 Revision 和差异；校验 Expected Head |
| Fork Artifact | 允许，但必须说明会创建新对象而不是修改原件 |
| 增加 File Version | 需要明确目标 File；高价值资料建议确认 |
| 覆盖原始 File Version | 禁止 |
| 刷新历史 Reference | 需要用户明确触发，避免改变历史语义 |
| 发布 Thread Snapshot | 用户触发或 Agent 提议后确认 |
| 将 Candidate 晋升为 Pinned Memory | 用户确认或明确授权 |
| 永久删除有引用的资源 | 高风险，必须确认并展示影响 |

### 11.3 模糊指令的处理

用户说“改一下这个文档”时，Agent 必须先解析明确目标：

- 当前打开的 Artifact 是哪个；
- 当前显示的是哪个 Revision；
- 用户想更新原 Artifact、Fork 新 Artifact，还是生成派生版本；
- Head 是否已在其他 Thread 中更新。

如果界面状态能够唯一确定目标，可直接执行并在操作结果中回显；如果不能唯一确定，才需要用户选择。

### 11.4 操作结果反馈

每个持久化写操作都应明确告诉用户：

```text
已创建 / 已修改什么
旧版本与新版本
是否改变当前 Head
是否影响其他 Thread
是否产生过期引用
是否存在冲突或需要后续处理
```

这比只显示“完成”更能建立可预测性。

---

## 十二、模型上下文装配

推荐在现有 `compileModelContext` 之上逐层加入：

```text
1. 稳定的 Agent System Prompt
2. 当前 Project Contract
3. 与任务相关的 Pinned Memory
4. 当前 Thread 的冻结继承上下文
5. 当前 Thread 消息
6. 用户本轮显式 Reference 的固定内容
7. 必要的近期相关变化摘要
8. 当前用户消息
```

关键原则：

- 权威状态优先于原始 Operation；
- 显式引用优先于全 Project 搜索；
- 固定版本优先于“总是取最新”；
- Activity 只在与任务相关时进入；
- Memory 必须携带作用域和状态；
- 旧版本可以被引用，但必须标记其版本与过期状态；
- 跨 Project 内容必须在所有读取路径上做所有权校验。

---

## 十三、核心风险验证

### 实验 1：是否需要完整 Event Sourcing

**问题：** 不把事件作为唯一状态来源，能否实现审计、恢复、并发和 Agent 活动感知？

**方法：** 用 Artifact 修改流程对比三种方案：只保存当前内容、完整 Event Sourcing、当前状态 + Revision + Operation。

**结论：** 第三种方案已覆盖首版关键需求；完整 Event Sourcing 增加事件重放和版本迁移成本，却不产生同等用户价值。

**影响：** Spec 阶段不设计全系统事件重放；Operation 是附加的领域事实记录。

### 实验 2：Operation 能否替代 Memory

**问题：** 是否可以把用户操作直接作为 LLM 长期记忆？

**方法：** 构造“重命名、打开、归档、更新文档、确认技术决策”等操作，判断哪些应影响未来回答。

**结论：** 大多数操作没有长期语义；直接作为 Memory 会引入大量噪声。只有从操作或内容中提炼出的稳定事实，才应进入 Candidate—确认流程。

### 实验 3：自动跟随最新版本是否更友好

**问题：** Reference 是否应总是解析到资源最新 Head？

**方法：** B1 引用 Artifact Revision 2 后，B2 将 Head 更新到 Revision 3，再复现 B1 历史回答。

**结论：** 自动跟随会改变历史语义，并导致无法复现。固定版本 + 更新提示 + 显式刷新更可靠。

### 实验 4：最后写入获胜是否足够

**问题：** 两条 Thread 同时修改 Artifact，能否让后提交者直接覆盖？

**方法：** 两者都基于 Revision 3 修改；B1 先提交 Revision 4，B2 随后提交。

**结论：** 最后写入获胜会静默丢失 B1 工作。Expected Head 校验能够在提交边界发现冲突。

### 实验 5：汇总是否可以只读取五条 Thread 的最后一条消息

**问题：** A 汇总 B1—B5 时，读取每条支线最后一条消息是否足够？

**结论：** 不足。最后一条消息可能只是追问、失败响应或局部修改。需要可发布 Snapshot，明确保存结论、证据、假设、冲突和未解决问题。

---

## 十四、Project 行为评测

### 14.1 评测模型需要扩展

当前评测主要输入消息和附件，并断言回答内容、路由、工具与终态。Project 评测还需要：

- 初始 Project 状态；
- Contract Version；
- Files 与 File Versions；
- Artifacts 与 Revisions/Head；
- References；
- Thread Snapshots；
- 预期 Operation；
- 预期最终状态和禁止副作用。

具体测试 Schema 属于 Spec 阶段。

### 14.2 P0 场景

1. **原始 File 不可覆盖**：要求 Agent 修改上传文件，结果必须创建派生 Artifact 或新 File Version。
2. **Artifact 更新产生新 Revision**：旧 Revision 保留，Head 正确更新。
3. **并发冲突**：Expected Head 过期时拒绝静默写入。
4. **固定 Reference**：来源更新后，历史 Thread 仍读取旧版本并显示更新提示。
5. **跨 Thread 不隐式污染**：B1 的新结论不自动进入 B2。
6. **五支线汇总**：结果包含全部五个 Snapshot 来源，并指出冲突和缺失。
7. **Operation 不自动成为 Memory**：普通重命名或归档不影响未来回答。
8. **Memory 晋升需要确认**：Candidate 未确认前不作为 Pinned Memory 使用。
9. **跨 Project 无泄漏**：任何 File、Artifact、Reference、Activity、Memory 读取都受 Project 所有权限制。
10. **模糊修改目标**：存在多个同名 Artifact 时不得静默选择错误对象。

### 14.3 关键指标

- Resource target accuracy；
- Revision correctness；
- Reference freshness awareness；
- Conflict detection rate；
- Source completeness；
- Forbidden mutation rate；
- Cross-project leakage rate；
- Memory promotion precision；
- Convergence conflict recall；
- User-visible operation explanation completeness。

---

## 十五、风险与偏差预期

| 风险点 | 可能偏差 | 发现方式 | 纠偏路径 |
|---|---|---|---|
| 版本对象过多 | 用户觉得概念复杂 | 可用性测试、误操作率 | UI 只展示“当前版/历史/已有更新”，隐藏内部术语 |
| Snapshot 质量不稳定 | 汇总遗漏重要结论 | 来源覆盖评测、人工抽检 | Snapshot 使用结构化模板并允许用户编辑 |
| Operation 过细 | Activity 噪声过大 | 事件量、用户忽略率 | 只保留领域动作，UI 做分组和摘要 |
| Memory 自动化过强 | 错误事实长期影响回答 | Memory 误晋升率 | 首版以用户确认优先，自动晋升仅限明确授权 |
| Agent 写入不透明 | 用户不知道改了哪个版本 | 写后解释完整率 | 所有写工具返回对象、父版本、新版本、影响范围 |
| 引用长期固定 | 用户错过最新信息 | 过期引用数量、刷新频率 | 明显提示新版本，并提供对比后刷新 |
| Convergence Bundle 过重 | 普通用户不会主动创建 | 汇总流程完成率 | 用户 `@` 多个 Thread 时自动形成临时 Bundle |
| 权限校验遗漏 | 跨 Project 数据泄漏 | 安全评测、所有权测试 | 统一 Repository/Service 入口，不允许工具直查裸表 |

---

## 十六、需要在后续阶段拍板的决策点

| 阶段 | 决策点 | 需要判断什么 |
|---|---|---|
| Spec | Contract 版本粒度 | 整体版本与局部编辑如何结合 |
| Spec | File 与 Attachment 关系 | 何时从消息附件晋升为 Project File |
| Spec | Artifact Head 与 Revision | 并发条件、Fork、Revert 的精确状态转换 |
| Spec | Reference 生命周期 | 创建、过期、刷新、删除的行为 |
| Spec | Thread Snapshot 结构 | 必须包含哪些结论、证据、假设和未解决问题 |
| Spec | Operation 保存期限 | 哪些长期保留，哪些只用于近期 Activity |
| Spec | Memory 授权策略 | 哪些类型必须逐条确认，哪些可批量授权 |
| Implement | 写工具确认边界 | 哪些操作直接执行，哪些先预览差异 |
| Implement | Context Budget | Contract、Memory、Reference、Activity 的截断顺序 |
| Verify | Project Evaluation Schema | 如何断言最终资源状态和禁止副作用 |

---

## 十七、未解决的不确定性

1. **Thread Snapshot 何时生成。** 可以由用户主动发布、Agent 在阶段结束时提议，或系统按规则创建；首版应避免每轮自动生成。
2. **File 新版本的格式支持。** 文本、Markdown 和代码易于处理，PDF、Office、图片需要不同的转换和验证策略。
3. **Artifact 多文件结构。** 当前 Artifact 偏单内容；未来代码工作台可能需要 Artifact Bundle 或 Workspace，但不应阻塞单文件 Revision 首版。
4. **Memory 的自动晋升。** 本轮只确认 Candidate—确认—生效框架，抽取、排序、衰减和冲突合并另做专题。
5. **Activity 的实时基础设施。** 单实例可从数据库提交后推送；多实例是否采用 Postgres LISTEN/NOTIFY、Redis 或消息系统，应由部署规模决定。
6. **团队协作权限。** 当前以单用户 Project 为主要假设；多人编辑需要进一步增加角色、资源权限和操作者身份模型。

这些不确定性不会推翻总体方向，可以在 Spec 或后续专题中逐步消除。

---

## 十八、进入 Spec 阶段的建议顺序

### S0：定义不变量

先把以下规则写成规范和验收条件：

- 原始 File Version 不可变；
- Artifact Revision 不可变；
- 跨 Thread Reference 固定明确版本；
- 写入校验 Expected Head；
- Operation 不自动成为 Memory；
- 未确认 Candidate 不进入 Pinned Memory；
- 所有资源读取必须校验 Project 所有权。

### S1：先打通最小资源闭环

```text
Project Contract
+ File/File Version
+ Artifact/Artifact Revision/Head
+ Operation
```

目标是完成“创建—修改—查看历史—冲突—恢复—活动记录”的单 Project 闭环。

### S2：加入 Reference 和 Thread Snapshot

打通：

```text
@File Version
@Artifact Revision
@Thread Snapshot
过期提示
显式刷新
```

### S3：加入多支线 Convergence

支持多个 Reference 的结构化汇总、来源追踪和冲突展示。

### S4：加入 Memory Candidate

先做用户确认的 Project Pinned Memory，再研究自动抽取、检索和衰减。

### S5：扩展 Evaluation

把资源状态、Operation 和禁止副作用加入现有 Agent Evaluation Harness。

---

## 十九、最终建议

ThreadChat 的 Project 应被定义为：

> 一个以 Contract 约束工作方向、以 File 和 Artifact 承载长期资产、以 Thread 承载探索过程、以显式 Reference 连接不同分支、以 Operation 记录变化、以 Memory 沉淀已确认语义的长期 AI 工作空间。

最关键的产品原则不是“让 Agent 尽可能知道更多”，而是：

```text
让 Agent 知道正确的当前状态，
知道本轮明确引用的来源，
知道哪些变化与当前任务相关，
并且让用户始终能够解释一次修改影响了什么。
```

这套设计既保留 Claude/ChatGPT Projects 的连续工作体验，又利用 ThreadChat 的分叉结构解决现有线性 Project 难以解决的来源追踪、多支线研究和可靠汇总问题。

---

## 参考资料

### 当前代码基线

- `lib/db/schema.ts`
- `lib/thread-chat/contracts/commands.ts`
- `lib/thread-chat/contracts/dto.ts`
- `lib/thread-chat/application/compile-model-context.ts`
- `lib/thread-chat/application/fork-thread.ts`
- `lib/thread-chat/persistence/command-repository.ts`
- `lib/thread-chat/streaming/artifacts.ts`
- `evals/agent/schema.ts`
- `evals/agent/cases/memory-context.json`

### 外部资料（调研时核验）

- OpenAI, Projects in ChatGPT: https://help.openai.com/en/articles/10169521-projects-in-chatgpt
- Anthropic, Create and manage projects: https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects
- Anthropic, Chat search and memory: https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context
- Anthropic, RAG for projects: https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects
- Anthropic, Artifacts: https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them
- Perplexity, Spaces: https://www.perplexity.ai/help-center/en/articles/10352961-what-are-spaces
- Google, NotebookLM sources: https://support.google.com/notebooklm/answer/16215270
- Notion, Enterprise Search: https://www.notion.com/help/enterprise-search
- Microsoft Azure Architecture Center, Event Sourcing pattern: https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing
- Git, `git update-ref`: https://git-scm.com/docs/git-update-ref.html
- MDN, Using server-sent events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
