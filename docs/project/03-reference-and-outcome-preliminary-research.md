# Project Reference 与 Outcome 初步调研文档

> 调研状态：初步收敛，待专题深挖  
> 调研日期：2026-08-31  
> 代码基线：`codex/feat-agent-observability-evaluation`  
> 基线提交：`48483101ad11bc84b611b615f423577633fedacb`  
> 工作分支：`codex/research-project-workspace-design`  
> 文档性质：汇总当前讨论结果，明确已经确定的产品边界、暂定方案和后续需要深度调研的问题。本文供下一轮 Research 和后续 Spec 阶段消费，不定义最终数据库字段和接口。

## 0. 本轮结论

当前方案从较复杂的“阶段成果发布、持续依赖、依赖过期传播、专门汇总对象”收敛为更小的产品模型：

```text
普通 Thread 探索
→ 生成 Outcome Markdown Artifact
→ 在其他 Thread 中结构化 @ 引用
→ 模型基于明确引用继续推理或综合
→ 必要时生成新的 Outcome / 最终 Artifact
```

首版核心只保留两项新能力：

1. **结构化 `@` 引用**：支持引用 `Thread`、`Message`、`Artifact` 三类实体。
2. **Outcome Markdown**：复用现有 Markdown Artifact 工具和基础设施，为“当前结论、方案交接、阶段总结”提供更严格的工具描述和生成规则。

首版明确不建立：

- `depends_on` 持续依赖关系；
- 独立的 `ThreadOutcome` 领域实体；
- Thread “发布完成”或“已交接”状态；
- 专门的 Convergence / 汇总对象；
- 依赖图、传递性过期传播和循环依赖检测；
- 完整 Event Sourcing；
- 自动将 Outcome 写入长期 Memory。

这些能力未来只有在真实使用证明“结构化引用 + Artifact”无法覆盖时再引入。

> 本文对 `docs/project/02-dependent-thread-handoff-research.md` 中关于 `depends_on`、独立阶段成果实体和专门汇总流程的建议做了收敛修正。02 文档保留为问题探索记录，当前产品方向以本文为准。

---

## 一、当前讨论结果

### 1.1 Project 的总体定位

Project 不是简单的聊天分组，而是一个长期 AI 工作空间。当前仍采用以下总体结构：

```text
Project
├── Contract
│   ├── Target
│   ├── Instructions
│   └── Pinned Memory
├── Files
├── Artifacts
├── Threads / Messages
├── Structured References
├── Operations / Activity
└── Memory（后续专题）
```

其中：

- **Contract** 提供项目级方向和稳定规则；
- **Files** 是用户上传的原始资料；
- **Artifacts** 是对话中生成、可跨 Thread 复用的工作成果；
- **Reference** 是把其他 Thread、Message、Artifact 带入当前消息的显式机制；
- **Operation** 记录发生过的业务操作；
- **Memory** 保存未来应继续影响 Agent 的事实、偏好和决策。

Operation 不等于 Memory，Outcome 也不自动等于 Memory。

### 1.2 Contract

当前认可的产品结构仍是：

```text
Project Contract
├── Target
├── Instructions
└── Pinned Memory
```

- `Target` 是项目灯塔，描述最终要达成什么；
- `Instructions` 是项目级工作方式和约束；
- `Pinned Memory` 是用户明确要求长期保留的重要事实、偏好和决策。

Pinned Memory 在产品界面中可以属于 Contract，但底层是否与 Target、Instructions 共用同一种版本机制，仍需后续专题判断。

### 1.3 Files

Files 是用户上传的原始资料，例如 PDF、Word、Excel、Markdown、图片、代码和数据文件。

当前原则：

1. 用户上传的原始 File Version 不由 Agent 原地覆盖；
2. 用户更新资料时，倾向于在同一逻辑 File 下增加新版本；
3. Agent 对原始资料进行改写时，通常生成 Derived Artifact；
4. 历史消息引用的是当时确定的 File Version，不随最新版静默变化。

File 的详细版本、替换、删除和派生语义仍待深度调研。

### 1.4 Artifacts

Artifacts 是对话中生成的长期成果，例如：

- Markdown 文档；
- JavaScript / TypeScript；
- HTML / CSS；
- Python 和其他代码文件；
- JSON、配置文件；
- 后续可能支持的表格和可交互预览。

当前倾向是：

```text
Artifact = 稳定逻辑身份
Artifact Revision = 一次不可变内容版本
Artifact Head = 当前最新版
```

该模型能让 `@Artifact` 固定到明确版本，并避免多个 Thread 静默覆盖彼此。

但首版 Artifact Revision 的具体范围、并发策略和用户更新体验仍需专题调研。

---

## 二、为什么不先做 `depends_on`

用户的真实场景是：

```text
主线 A 提出五个方向
→ 方向 1 在深层子 Thread 中确定方案
→ 方向 2 需要使用方向 1 的结果
→ 最后回到 A 综合多个方向
```

最初考虑通过：

```text
方向 2 depends_on 方向 1 v3
```

建立持续依赖关系。但这会迅速引入：

- 依赖创建、解除和替换；
- 上游更新后的过期状态；
- 用户保留旧版本或升级到新版本；
- 依赖环检测；
- 传递依赖；
- Thread 归档、Artifact Fork 后的关系处理；
- 历史消息与当前依赖版本不一致；
- 大量组合测试。

对用户而言，“一次性引用”和“持续依赖”也很难直观区分。

当前判断是：

> 用户真正需要的是把某个已整理结果可靠地带到另一个 Thread，而不是先管理一张项目依赖图。

因此首版改为：

```text
在上游生成 Outcome Artifact
→ 下游通过 @Artifact 明确引用
```

如果上游 Outcome 后来生成新 Revision，历史引用继续固定旧 Revision。用户需要新版本时再次 `@`，或者同时引用新旧两个版本进行比较。

未来若用户频繁需要“每轮持续携带同一个 Artifact”，优先考虑更直观的：

```text
固定到当前 Thread
```

而不是直接引入 `depends_on`。

---

## 三、结构化 `@` 引用

### 3.1 支持的三类实体

MVP 支持：

```text
@Thread
@Message
@Artifact
```

不把 `@` 当成纯文本，也不让模型自行决定调用哪个读取工具。

推荐链路：

```text
用户在 Composer 输入 @
→ 前端搜索当前 Project 中可引用实体
→ 用户选择明确对象
→ Composer 保存结构化引用
→ Send Command 提交文本和引用
→ 服务端校验归属与权限
→ 服务端固定 Message / Thread Snapshot / Artifact Revision
→ Context Compiler 按顺序展开
→ 模型收到明确、可重放的上下文
```

这样引用目标由用户确定，而不是依赖模型是否正确调用工具。

### 3.2 `@Message`

语义：引用一条明确 Message。

适合：

- 一条准确结论；
- 一段代码；
- 一次模型解释；
- 不值得生成独立 Artifact 的轻量信息。

当前倾向：历史引用固定原 Message。即使该 Message 后续通过 Retry 或 Edit 产生新版本，旧引用也不自动切换。

待调研：

- 是否支持引用整条 Message 和选中段落两种模式；
- 当前已有 Quote/TextAnchor 是否可以直接复用；
- 被 supersede 的 Message 在引用搜索和历史展示中如何处理。

### 3.3 `@Artifact`

语义：引用一个明确的 Artifact Revision。

适合：

- Outcome；
- 方案文档；
- 研究报告；
- Spec；
- 代码文件；
- 最终交付物。

UI 可以允许用户选择“最新版”，但发送消息时必须解析为确定的 Revision。

例如用户看到：

```text
@方向1方案总结.md · 最新版
```

消息落库时保存：

```text
artifactId
artifactRevisionId
```

历史消息不会随着 Artifact Head 更新而变化。

### 3.4 `@Thread`

语义需要保持克制。

当前建议：

1. 只引用目标 Thread 自己的有效时间线；
2. 不自动递归包含其子 Thread；
3. 发送时冻结为 Thread Snapshot；
4. Thread 后续新增消息不改变旧 Snapshot；
5. Thread 太长时，不应静默生成不可见摘要冒充完整 Thread。

长 Thread 的可选处理方式待调研，候选包括：

- 最近一轮；
- 当前有效时间线；
- 用户选择若干 Message；
- 显式生成 Outcome Artifact；
- 用户可见并确认的 Thread 摘要。

当前产品方向优先鼓励：

> 轻量信息引用 Message；复杂交接生成 Outcome Artifact；`@Thread` 作为方便但边界明确的补充能力。

### 3.5 多引用综合

用户可以在主线 A 中输入：

```text
@方向1总结.md
@方向2总结.md
@方向3结论.md
@方向4方案.md
@方向5风险.md

综合以上结果，形成最终方案。
```

这只是一次普通模型任务：

```text
当前 Thread 上下文
+ 多个结构化引用
+ 用户综合指令
```

模型可以直接回复，也可以继续调用 Markdown Artifact 工具生成最终文档。

首版不建立专门的“汇总对象”或“合并状态机”。

---

## 四、Outcome 的产品定义

### 4.1 Outcome 不是新领域实体

Outcome 的最小定义是：

```text
一个用途为阶段总结的普通 Markdown Artifact
```

例如：

```text
Artifact kind = markdown
Artifact metadata.purpose = outcome
```

Outcome 不意味着：

- Thread 已完成；
- Thread 已发布；
- 用户正式接受了全部内容；
- 当前方向进入某种状态；
- 必须创建 Handoff 记录；
- 必须绑定用户手动选择的 Message ID；
- 必须生成依赖关系。

用户只需像普通聊天一样说：

```text
帮我把当前已确定的方案总结成 Markdown。
```

系统生成一个可在 Project 中复用的 Markdown Artifact。

### 4.2 Outcome 与交接（Handoff）的关系

语义上建议这样理解：

```text
Outcome Artifact
= 被交接的工作成果

@ Reference
= 传递成果的方式

Handoff
= 上游创建成果，并由下游明确引用的完整用户行为
```

因此：

```text
生成 Outcome
≠ 已完成交接
```

只有它在其他 Thread 中被 `@` 使用后，才发生了基于 Artifact 的交接。

首版不需要 Handoff 数据库实体或状态机。

### 4.3 Outcome 工具如何复用 Markdown 工具

当前建议：模型侧可以拥有一个更明确的工具别名或专用描述，但底层完全复用 Markdown Artifact 实现。

候选方式：

#### 方式 A：相同工具名，动态切换描述

```text
createMarkdownArtifact
```

普通文档请求使用普通描述；Outcome 请求使用严格的总结描述。

优点：工具数量最少。  
风险：工具意图和评测记录不够清晰。

#### 方式 B：模型侧独立工具别名，底层共用实现

```text
createMarkdownArtifact
createOutcomeMarkdownArtifact
```

两者使用相同输入：

```text
title
content
```

两者复用：

- 同一 Zod Schema；
- 同一流式工具输入处理；
- 同一 Artifact 创建服务；
- 同一 Markdown UI；
- 同一 Revision 基础设施。

差别只有：

- 工具名称；
- 工具描述；
- `metadata.purpose = outcome`；
- 单独的 Outcome 评测。

当前更倾向方式 B，但需要通过实验验证两个近似工具是否会增加模型误调用。为降低冲突，同一轮通常只挂载其中一个工具。

---

## 五、Outcome 为什么容易总结错误

普通“总结聊天”很容易出现：

1. 把 Assistant 的建议写成用户已确认决定；
2. 把已经被后续否决的旧方案写成当前方案；
3. 面对冲突时擅自拍板；
4. 为了文档完整补充对话中没有的设计；
5. 混淆继承背景、当前分支结论和显式引用资料；
6. 生成流水账，遗漏真正影响后续工作的约束；
7. 忽略较早但已经明确确认的关键决定。

因此 Outcome 不是普通摘要，而更接近：

```text
从当前有效上下文中提取当前权威工作状态
```

### 5.1 默认总结范围

当前暂定范围：

```text
当前 Thread 的冻结继承上下文
+ 当前 Thread 的有效时间线
+ 当前用户消息显式 @ 的 Message / Thread Snapshot / Artifact Revision
```

默认不包括：

- 未显式引用的兄弟 Thread；
- 当前 Thread 的子 Thread；
- Project 中全部其他 Artifacts；
- 未显式引用的 Files；
- 已被 supersede 的旧 Message；
- 失败生成；
- 模型自行推测的 Project 信息。

用户不需要手动选择 Message ID，服务端根据当前有效上下文自动确定范围。

### 5.2 信息权威顺序

暂定判断顺序：

```text
用户最新明确更正
>
用户明确确认的选择
>
后续讨论明确以其为前提的工作方向
>
Assistant 提出的方案建议
>
模型为了补全结构所做的推断
```

后两类不能直接写成“已确认”。

尤其需要坚持：

> Assistant 提出建议后，用户没有反驳，不等于用户已经确认。

### 5.3 Outcome 的信息分类

推荐至少区分：

1. 已确认结论；
2. 已确认的改造细节；
3. 对后续步骤的约束；
4. 当前工作假设；
5. 已否决或已被替代的方案；
6. 未解决问题；
7. 来源说明。

某个分类没有足够依据时，可以省略或明确写“当前没有已确认内容”，不能为了填满模板而编造。

### 5.4 推荐 Markdown 结构

```markdown
# 阶段总结：方向 1

## 本次总结范围

## 已确认结论

## 已确认的改造细节

## 对后续步骤的约束

## 当前工作假设

## 已否决或已被替代的方案

## 未解决问题

## 来源说明
```

该结构是推荐模板，不要求每个章节都必须存在。

### 5.5 生成前校验

Outcome 工具描述应要求模型在生成前完成：

```text
冲突检查：
是否把两个互相冲突的方案都写成已确认？

时序检查：
是否使用了已被后续更正或替代的旧结论？

证据检查：
每条“已确认”内容是否确实能从当前上下文得到支持？
```

不要求向用户展示模型完整思考过程，最终只输出校验后的文档。

---

## 六、Provenance：首版记录多少来源信息

用户不需要操作 Message ID，但系统仍应自动保留基础来源。

当前 Artifact 已经拥有：

```text
projectId
sourceMessageId
```

这能回答：

- Artifact 属于哪个 Project；
- 它由哪次 Assistant Message 生成；
- 它来自哪个 Thread；
- 生成失败或内容异常时如何定位。

对于 Outcome MVP，暂时不要求用户手动选择：

```text
sourceMessageIds
sourceRange
acceptedByUser
publishedAt
handoffState
directionId
```

但仍需深度调研：

1. 仅 `sourceMessageId` 是否足够支持后续来源解释；
2. 是否应自动保存本轮使用的结构化 Reference IDs；
3. 是否需要记录 Outcome 的输入 Thread Snapshot；
4. 是否需要为每条已确认结论建立 Evidence Mapping；
5. 来源信息应展示给用户多少，避免 UI 过重。

---

## 七、Operations 与 Memory

### 7.1 Operation

建议继续区分业务操作和记忆。

可能记录的操作包括：

```text
artifact.created
artifact.revision.created
reference.created
file.version.added
contract.updated
memory.pinned
```

Operation 用于：

- 用户活动记录；
- 来源审计；
- UI 实时更新；
- Agent 在需要时了解近期相关变化。

EventSource / SSE 只负责把操作结果实时传到浏览器，不是权威存储，也不会自动让 LLM 知道用户操作。

### 7.2 Memory

Outcome 或一次 `@` 引用不会自动写入 Memory。

后续 Memory 专题至少需要区分：

```text
Personal Memory
Project Pinned Memory
Project Working Memory
Thread Memory
Artifact-derived Knowledge
Current Working Context
```

当前只确定：

- Pinned Memory 需要用户明确确认；
- Agent 可以提出 Memory Candidate；
- Operation 不能直接当成 Memory；
- Outcome 中的某条长期决策可以被用户另行提升为 Project Memory。

---

## 八、MVP 用户故事

### 8.1 深层子 Thread 形成方向 1 的结果

```text
A
└── A1
    └── A1.3
        └── A1.3.2
```

用户在 A1.3.2 中说：

```text
请把当前已经确定的方案、改造细节、
对后续步骤的约束和未解决问题整理成 Markdown。
```

模型生成：

```text
方向1方案总结.md · r1
purpose = outcome
```

### 8.2 方向 2 使用方向 1 的结果

用户进入 A2：

```text
@方向1方案总结.md · r1

基于这个方案设计方向 2。
```

这条消息永久绑定 r1。

### 8.3 方向 1 后来更新

用户继续研究并生成：

```text
方向1方案总结.md · r2
```

A2 的历史消息仍然引用 r1。

用户需要重新评估时可以：

```text
@方向1方案总结.md · r1
@方向1方案总结.md · r2

比较两个版本，并判断方向 2 是否需要调整。
```

### 8.4 主线综合多个方向

用户回到 A：

```text
@方向1方案总结.md · r2
@方向2方案总结.md · r3
@方向3调研结论.md · r1
@方向4方案总结.md · r2
@方向5风险分析.md · r1

综合成最终实施方案，并生成 Markdown 文档。
```

模型正常综合并生成新的 Artifact。

该流程不需要独立汇总实体、依赖图或 Thread 状态机。

---

## 九、当前已经确定的决策

### D1. Project Contract

继续采用：

```text
Target + Instructions + Pinned Memory
```

### D2. 原始 Files

原始 File Version 不由 Agent 原地覆盖。

### D3. Outcome

Outcome 是带 `purpose=outcome` 的普通 Markdown Artifact，不是独立领域实体。

### D4. Outcome 的用户操作

生成 Outcome 是一次普通用户消息和普通 Artifact 工具调用，不要求用户选择 Message ID，不改变 Thread 状态。

### D5. Handoff

Handoff 是“上游生成 Artifact、下游通过 `@` 使用”的行为语义，不建立 Handoff 实体。

### D6. Reference

MVP 支持：

```text
@Thread
@Message
@Artifact
```

引用必须结构化保存，并由服务端验证。

### D7. 历史稳定性

`@Artifact` 固定明确 Revision；`@Thread` 固定明确 Snapshot；`@Message` 固定明确 Message。

### D8. 汇总

多方向汇总是模型针对多个结构化引用执行的普通综合任务，不建立专门 Convergence 实体。

### D9. 依赖关系

首版不实现 `depends_on` 和项目依赖图。

### D10. Memory

Outcome、Reference 和 Operation 不自动进入长期 Memory。

---

## 十、当前暂定、需要验证的假设

### H1. Outcome 工具

模型侧使用独立的 `createOutcomeMarkdownArtifact`，底层完全复用 Markdown Artifact 实现，可能比动态修改同一个工具描述更容易评测和观察。

### H2. 工具挂载

同一轮只挂载普通 Markdown 工具或 Outcome Markdown 工具中的一个，以减少近似工具选择冲突。

### H3. `@Thread`

`@Thread` 默认只引用目标 Thread 自身有效时间线，不递归包含子 Thread。

### H4. Thread Snapshot

Thread 引用在发送时冻结，不跟随目标 Thread 后续新增内容。

### H5. Artifact Revision

Artifact 需要稳定身份和不可变 Revision，才能让历史 `@Artifact` 可重放。

### H6. Outcome 范围

Outcome 默认使用当前 Thread 有效上下文和本轮显式 References，不自动读取 Project 中其他内容。

### H7. Outcome 正确性

通过严格的工具描述、分类模板、时序和冲突检查，可以在不增加复杂工作流的情况下达到可接受正确率。

以上假设都需要通过专题调研或最小实验验证。

---

## 十一、待深度调研的问题

### R1. Outcome 正确性与评测方法【P0，深度】

核心问题：

1. 模型如何可靠区分“用户确认”“当前假设”“Assistant 建议”和“已否决方案”？
2. 分支中最新决定如何覆盖继承上下文的旧决定？
3. 多个明确引用内容冲突时，Outcome 应如何表达？
4. 单次工具调用是否足够，还是需要“先提取结构化状态，再渲染 Markdown”的两步方案？
5. 是否需要为结论附带轻量证据引用？
6. 不同模型上的稳定性差异有多大？

建议验证：

- 建立 30—50 个合成对话案例；
- 覆盖更正、否决、未确认、分支覆盖、引用冲突和信息缺失；
- 比较普通摘要 Prompt、严格 Outcome Prompt、两步结构化提取三种方案；
- 评估已确认结论准确率、错误确认率、遗漏率和幻觉率。

### R2. `@` Composer 与用户交互【P0，深度】

核心问题：

1. 如何在同一个 `@` 搜索框中清楚区分 Thread、Message 和 Artifact？
2. Message 如何被用户找到：按当前页面选中、按搜索结果，还是按引用最近内容？
3. Artifact 是否展示 Head、Revision、来源 Thread 和类型？
4. 用户选择“最新版”时，发送前如何让其知道最终固定的是哪个 Revision？
5. 多个 References 如何排序、删除和预览？
6. 移动端 Composer 的交互如何保持可用？

建议验证：

- 做交互原型；
- 用 5—8 个真实任务测试用户是否能正确选择目标实体；
- 重点观察同名 Artifact、深层 Thread 和长标题场景。

### R3. `@Thread` 的范围与长上下文处理【P0，深度】

核心问题：

1. 默认是完整有效时间线、最近一轮还是用户选择范围？
2. 长 Thread 超出预算时如何处理，才能避免静默丢信息？
3. Thread Snapshot 是否保存 Message IDs，还是保存规范化内容副本？
4. Snapshot 中的附件、工具结果和 Artifact References 如何展开？
5. 是否允许用户显式选择“包含子 Thread”，以及是否值得首版支持？

建议方向：

- 首版不递归子 Thread；
- 对过长 Thread 引导用户生成 Outcome，或显式选择 Message；
- 不在后台静默总结整个 Thread 冒充原文。

### R4. Reference 的持久化与上下文装配【P0，深度】

核心问题：

1. Reference 保存为 Message Part、独立关联表，还是两者结合？
2. 客户端提交哪些 ID，服务端如何验证并冻结版本？
3. 上下文中引用内容放在用户消息之前还是作为独立服务端 Context？
4. 多引用如何去重、排序和控制 Token 预算？
5. 被引用 Message/Artifact 后续归档或删除时，历史如何重放？
6. 如何禁止跨用户、跨 Project 泄漏？

需要结合当前：

- `ThreadChatUIMessage.parts`；
- `compileModelContext`；
- `forkContext`；
- `conversationCommands`；
- Attachment 解析链路。

### R5. Artifact Revision 生命周期【P0，深度】

核心问题：

1. 一个 Artifact 的稳定身份如何创建？
2. “更新这个文档”默认产生新 Revision，还是创建新 Artifact？
3. Artifact Head 如何移动？
4. 两个 Thread 同时基于 r2 生成 r3 时如何处理？
5. 是否首版就需要 Fork、Diff、Revert？
6. 普通 Markdown、Outcome、代码文件是否共用同一 Revision 模型？
7. 用户直接编辑 Artifact 后如何产生 Revision 和来源记录？

这是结构化 `@Artifact` 成立的前置能力。

### R6. Outcome Tool 的技术形态【P1，中深度】

需要比较：

1. 同一工具名、动态描述；
2. 独立工具别名、共用实现；
3. 一个工具增加 `purpose` 参数；
4. 应用先做意图识别，再决定挂载哪个工具；
5. 让模型自己选择普通 Markdown 或 Outcome。

验证指标：

- 工具选择正确率；
- 用户没有要求文件时的误调用率；
- 普通 Markdown 与 Outcome 的混淆率；
- 不同模型兼容性；
- 工具描述长度和维护成本。

### R7. Outcome Provenance【P1，中深度】

核心问题：

1. `sourceMessageId` 是否足够？
2. 是否保存本轮 Reference IDs 和 Thread Snapshot ID？
3. 是否需要保存“生成时上下文清单”？
4. 是否为每个结论建立来源 Message 映射？
5. 用户需要看到多细的来源？
6. 过细 Provenance 是否会让 UI 和生成流程过重？

建议优先验证最低充分集合，而不是一开始做逐句证据图谱。

### R8. Files 与 Project Assets【P1，深度】

核心问题：

1. 当前 Attachment 如何升级为 Project File？
2. 一个 Attachment 是否可以同时作为 Message 附件和 Project File Version？
3. 用户上传同名文件时是新 File 还是新 Version？
4. Word、Excel、代码目录和压缩包如何解析与引用？
5. Agent 从 File 生成 Derived Artifact 时如何记录关系？
6. File 删除、归档和移出 Project 的语义是什么？

### R9. Operation 与 Activity【P1，中等】

核心问题：

1. 哪些行为值得进入 Project Operation Ledger？
2. `conversation_commands` 是否只保留幂等收据，另建语义操作表？
3. UI Activity Feed 是否进入首版？
4. Agent 什么时候需要读取近期操作？
5. 如何避免把完整操作日志塞入模型？
6. SSE/EventSource 应承载哪些实时通知？

### R10. Memory 分层【P2，专题】

需要单独研究：

- Personal / Project / Thread Memory 的作用域；
- Pinned、Candidate、Active、Superseded 状态；
- 自动抽取和用户确认；
- Memory 与 Contract 的边界；
- Memory 与 Artifact、Outcome、Operation 的关系；
- 召回、冲突、衰减和压缩；
- 跨 Project 隔离和隐私。

本轮只保留边界，不进入算法与完整数据模型。

### R11. Project Evaluation【P0—P1，深度】

需要从当前只看回答文本，扩展为同时断言状态和副作用。

至少测试：

1. Outcome 不把 Assistant 建议写成用户决定；
2. 最新更正覆盖旧结论；
3. 未解决冲突不擅自拍板；
4. 已否决方案与当前方案分离；
5. 当前分支决定覆盖继承背景；
6. Outcome 不读取未显式引用的其他 Thread；
7. `@Message` 固定原 Message；
8. `@Artifact` 固定原 Revision；
9. `@Thread` 固定原 Snapshot；
10. 多引用按用户顺序展开且不重复；
11. 跨 Project Reference 被拒绝且不泄漏实体存在性；
12. Outcome 不自动写 Memory；
13. 原始 File 未被 Agent 覆盖。

---

## 十二、建议的下一轮调研顺序

### 第一组：决定 MVP 是否成立

```text
R1 Outcome 正确性
R3 @Thread 范围
R4 Reference 持久化与上下文装配
R5 Artifact Revision
R11 Evaluation
```

这五项构成核心路径。任何一项结论不成立，都可能改变 MVP。

### 第二组：决定用户体验质量

```text
R2 @ Composer
R6 Outcome Tool 形态
R7 Provenance
R8 Files
```

### 第三组：Project 长期能力

```text
R9 Operation / Activity
R10 Memory 分层
```

---

## 十三、初步验收标准

当下列条件成立时，可以认为 Reference + Outcome MVP 的方向已经研究清楚：

1. 用户能在 Composer 中明确选择 Thread、Message 或 Artifact；
2. Reference 在发送时被服务端固定为明确 Message、Snapshot 或 Revision；
3. 历史引用不会随着来源更新而漂移；
4. 深层子 Thread 可以通过普通用户消息生成 Outcome Markdown；
5. Outcome 不要求修改 Thread 状态或手选 Message ID；
6. Outcome 能可靠区分已确认、假设、已否决和未解决内容；
7. 其他 Thread 可以 `@Outcome` 并继续正常推理；
8. 多个 Outcome 可以在主线中被普通模型综合；
9. Outcome 和 Reference 不会自动改变 Contract 或 Memory；
10. 原始 Files 不被 Agent 静默覆盖；
11. 跨 Project 和跨用户引用在模型调用前被拒绝；
12. 核心行为具备可重复的自动评测案例。

---

## 十四、进入 Spec 前仍需用户拍板的决策

1. `@Thread` 首版默认引用完整有效时间线，还是最近一轮？
2. Artifact Revision 是否作为 `@Artifact` MVP 的硬前置，还是先用不可变单次 Artifact 规避更新？
3. Outcome 工具使用独立别名，还是复用同名工具并动态切换描述？
4. Outcome 是否需要在 Markdown 中展示来源章节？
5. `@Message` 首版是否支持文本选区，还是只支持整条 Message？
6. Artifact 新 Revision 是否必须由用户显式确认，还是 Agent 可直接生成后由用户检查？
7. Project Activity Feed 是否进入首版，还是只先保存 Operation？
8. Files 首版是 Project 全局可见，还是必须由用户 `@` 后才进入模型上下文？

这些问题需要在深度调研结果出来后再进入最终 Spec。
