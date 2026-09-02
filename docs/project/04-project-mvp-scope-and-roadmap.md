# ThreadChat Project MVP 范围冻结与开发节奏

> 状态：当前产品决策，以本文为准  
> 日期：2026-08-31  
> 代码基线：`codex/feat-agent-observability-evaluation`  
> 基线提交：`48483101ad11bc84b611b615f423577633fedacb`  
> 工作分支：`codex/research-project-workspace-design`  
> 文档性质：Research 阶段范围冻结与开发节奏建议，不定义最终数据库字段、接口或页面组件。

## 0. 结论

当前应当停止继续扩展 Project 的复杂设计，也不立即实现完整的跨 Thread 协作系统。

已经证明以下方向在逻辑上可行：

```text
Project Contract
+ Files / Artifacts
+ Thread 分叉
+ 显式引用
```

但现阶段不应继续实现：

```text
depends_on
依赖图
专门汇总对象
独立 Outcome 实体
Handoff 状态机
Approval 状态机
完整 Operations / Activity Feed
自动 Project Memory
复杂的 @Thread 自动总结
```

当前最值得保留的产品判断是：

> Project 定义项目级 Contract、原始资料、工作成果和对话分支的组织方式；规定这些实体的来源、修改和引用边界；未来通过显式 `@` 将不同 Thread 中的必要信息传入当前上下文，从而支持先分叉探索，再由用户主动聚合。

开发节奏应采用“先验证必要性，再逐层增加能力”的方式。首个跨 Thread 能力优先考虑 `@Artifact`，而不是 `@Thread`。

---

## 一、Project 当前冻结的总体模型

```text
Project
├── Contract
│   ├── Target
│   ├── Instructions
│   └── Pinned Memory（先保留位置，后续专题）
├── Files
├── Artifacts
├── Threads / Messages
└── Structured References（按需逐步实现）
```

### 1.1 Contract

Contract 是 Project 的方向性纲领：

- `Target`：项目最终要达成什么，是项目灯塔；
- `Instructions`：Agent 在该 Project 中应遵守的工作方式和约束；
- `Pinned Memory`：用户明确要求长期保留的项目事实、偏好和决定。

MVP 中 Target 和 Instructions 的价值明确，应优先实现。

Pinned Memory 可以在产品结构中预留，但暂不扩展为自动抽取、自动召回和自动更新的完整记忆系统。

### 1.2 Files

Files 是用户上传的原始资料，例如 PDF、Word、Excel、Markdown、图片、代码和数据文件。

当前原则：

1. 用户上传的原始 File 不由 Agent 静默覆盖；
2. Agent 改写原始资料时，优先生成新的 Artifact；
3. 用户上传替代资料时，未来可以再评估 File Version；
4. File 的完整版本、替换、归档和删除语义不作为首个 Project MVP 的阻塞项。

### 1.3 Artifacts

Artifacts 是用户和 AI 在对话中生成的长期工作成果，例如：

- Markdown 文档；
- HTML、CSS、JavaScript、TypeScript；
- Python 和其他代码；
- JSON、配置文件；
- 后续可能支持的表格和交互预览。

Artifact 具有 Project 级归属，因此虽然它创建于某个 Thread 的某次 Assistant Message，但可以在同一 Project 的其他 Thread 中复用。

当前已有 Artifact 是一次生成对应一个独立对象。只要首版不支持“原地更新同一份 Artifact”，`@Artifact` 可以先直接固定 Artifact ID，不必提前实现完整 Artifact Revision 系统。

当产品真正支持“更新这个文档”时，再引入：

```text
Artifact
└── Artifact Revisions
```

而不是为尚未存在的编辑体验提前构建完整版本系统。

### 1.4 Threads / Messages

Thread 是探索过程，不天然代表正式成果。

Message 是更精确的讨论单元。当前已有 Fork、冻结继承上下文和 Message 替换语义，可以继续作为后续引用能力的基础。

### 1.5 Structured References

未来支持：

```text
@Artifact
@Message
@Thread
```

三者不应同时作为首版一次性完成。优先级应为：

```text
@Artifact
→ @Message
→ 根据真实使用再决定 @Thread
```

---

## 二、为什么现在要搁置复杂方案

复杂方案并非错误，而是当前投入产出比不足。

### 2.1 `depends_on` 的复杂度大于当前价值

持续依赖关系会引入：

- 创建、解除和替换依赖；
- 上游更新后的过期状态；
- 保留旧版或升级新版；
- 依赖环检测；
- 传递依赖；
- Thread 归档后的关系处理；
- 历史消息与当前依赖版本不一致；
- 大量组合测试和新的用户概念。

当前真实需求主要是：

> 把另一个 Thread 中已经整理好的结果带到当前 Thread。

这个需求可以先通过：

```text
生成 Markdown Artifact
→ 在下游 @Artifact
```

满足，不需要先管理一张依赖图。

### 2.2 汇总不必成为领域对象

“先分叉后聚合”是用户的工作方式，但聚合不一定要成为系统实体。

用户可以在主线中引用多份 Artifact 或 Message，并提出普通综合任务：

```text
@方向1方案.md
@方向2方案.md
@方向3风险.md

请综合以上材料，形成最终实施方案。
```

对系统来说，这只是一次带多个明确上下文的普通模型调用。

当前不需要：

- Convergence Bundle；
- Merge Session；
- 汇总状态机；
- 方向依赖图；
- 独立聚合生命周期。

### 2.3 Outcome 不必成为独立实体

Outcome 可以只是普通 Markdown Artifact。

```text
Outcome Artifact
= 一份用于阶段总结或交接的 Markdown Artifact
```

不需要：

- Thread 完成状态；
- 发布状态；
- Outcome 审批状态；
- Handoff 实体；
- 用户手工选择一组 Message ID；
- 独立 Outcome 数据表。

### 2.4 Operations / Activity 暂时没有必要

Operation 回答“发生过什么”，Activity 是面向用户或 Agent 的近期活动视图。

当前单用户、显式 Thread、显式引用的产品模式中，已有实体的基础来源字段通常已经足够：

- `projectId`；
- `threadId`；
- `sourceMessageId`；
- `createdAt`；
- `updatedAt`。

完整 Operation Ledger 和 Activity Feed 在以下情况出现后才更有价值：

- Artifact 支持多个 Revision；
- 多用户协作；
- 需要撤销、恢复和审计；
- 用户频繁询问“最近改了什么”；
- 引用更新需要跨 Thread 通知。

因此当前只保留概念，不进入 MVP，也不自动把 Activity 注入 Agent 上下文。

---

## 三、必要性评估

| 能力 | 当前必要性 | 实现复杂度 | 当前建议 |
|---|---:|---:|---|
| Project Target | 高 | 低—中 | 优先实现 |
| Project Instructions | 高 | 低—中 | 优先实现 |
| Pinned Memory | 中 | 中—高 | 先保留位置，暂不做自动记忆 |
| Project Files 区域 | 高 | 中 | Project MVP 实现 |
| Project Artifacts 区域 | 高 | 低—中 | 复用现有 Artifact 基础 |
| `@Artifact` | 高 | 中 | 首个跨 Thread 能力 |
| `@Message` | 中 | 中 | 第二阶段 |
| `@Thread` | 中 | 高 | 暂缓，先观察真实需求 |
| Outcome 专用工具 | 低—中 | 中 | 先复用普通 Markdown 工具 |
| Outcome Approval Card | 低 | 中—高 | 暂缓 |
| Artifact Revision | 中高 | 高 | 真正支持更新 Artifact 时再做 |
| Operations / Activity Feed | 低 | 中—高 | 暂缓 |
| 自动 Project Memory | 潜在价值高 | 很高 | 后续单独专题 |
| Convergence / 汇总实体 | 低 | 高 | 不做 |

核心判断：

> `@Artifact` 的投入产出比明显高于 `@Thread`。只要用户能在深层 Thread 中生成 Markdown Artifact，并在其他 Thread 中可靠引用，就已经覆盖大部分跨 Thread 信息传递需求。

---

## 四、推荐开发节奏

### 阶段 0：暂停扩展设计，观察真实使用

当前不进入完整 Project Spec，也不实现复杂 Reference、Outcome、Memory 或 Activity。

现有 Research 文档作为设计储备。继续真实使用当前产品，观察以下问题是否反复出现：

- 是否经常需要复制另一个 Thread 的结论；
- 是否经常找不到以前生成的 Artifact；
- 是否反复让模型总结同一段讨论；
- 是否频繁在多个 Thread 中复用同一份文档；
- 是否因跨 Thread 信息未传递而产生错误设计；
- 普通 Markdown 总结是否经常把结论总结错。

只有问题重复出现，才进入对应能力的 Spec 和实现。

### 阶段 1：最小 Project

首版只实现：

```text
Project
├── Target
├── Instructions
├── Files
├── Artifacts
└── Threads
```

建议：

- Target 和 Instructions 先保存当前值，不急着实现完整版本历史；
- Pinned Memory 先预留界面和概念，不做自动抽取；
- Files 和 Artifacts 进入清晰的 Project 资源区域；
- Artifact 保留来源 Thread 和 Message；
- 这一阶段可以不实现任何 `@`。

### 阶段 2：只做 `@Artifact`

允许用户在当前 Project 的输入框中选择一个既有 Artifact：

```text
@方向1方案总结.md
```

服务端验证 Artifact 属于当前用户和当前 Project，然后将明确内容带入本轮上下文。

如果 Artifact 仍是一次生成一个独立对象，则直接固定 Artifact ID 即可。

### 阶段 3：实现 `@Message`

当用户频繁只需要引用一条结论，而不值得生成文档时，再实现：

```text
@某条 Message
```

它比 `@Thread` 更精确、可预测，也更容易测试。

### 阶段 4：评估是否需要 `@Thread`

只有当用户反复出现以下需求时再实现：

> 我不想先生成 Markdown，只想把另一条 Thread 的新增讨论带到当前 Thread。

即使实现，也先做结构化消息差量引用，不做递归子树总结、依赖图和自动 Handoff。

### 阶段 5：再决定 Outcome、Approval、Memory

当 Outcome 被频繁用于其他 Thread，且总结错误成为真实风险时，再依次考虑：

1. Outcome 专用工具描述；
2. Outcome Evaluation；
3. 生成后确认提示；
4. Approval Card；
5. Artifact Revision；
6. Project Memory。

---

## 五、Outcome 的当前定位

### 5.1 先复用普通 Markdown 工具

用户像普通聊天一样说：

```text
帮我把当前已经确定的方案、改造细节、后续约束和未解决问题总结成 Markdown。
```

模型继续调用现有 Markdown Artifact 工具。

首版不要求：

- 独立 Outcome 工具；
- 特殊 Message ID；
- Thread 状态变化；
- 发布流程；
- 审批流程。

如果后续评测显示普通 Markdown Prompt 的错误率不可接受，再增加 Outcome 专用工具描述或别名。

### 5.2 Outcome 与 Handoff

```text
Outcome Artifact
= 被传递的工作成果

@ Reference
= 传递成果的方式

Handoff
= 上游生成 Artifact，并在下游引用使用的完整用户行为
```

Handoff 是用户故事和行为语义，不需要成为数据库领域对象。

---

## 六、如何尽量提高 Outcome 总结正确性

仅靠更长 Prompt 无法保证总结正确。当前建议按以下层级处理。

### 6.1 明确总结范围

默认总结：

```text
当前 Thread 的冻结继承背景
+ 当前 Thread 的有效讨论
+ 用户本轮显式引用的内容
```

默认不包含：

- 未引用的兄弟 Thread；
- 当前 Thread 的子 Thread；
- Project 中所有其他 Artifact；
- 未引用的 Files；
- 已被替换的旧消息；
- 失败生成；
- 模型自行猜测的 Project 信息。

用户不需要手动选择 Message ID。服务端本来就知道当前 Thread 的有效上下文和本轮显式引用。

### 6.2 强制分类，不做自由摘要

推荐要求模型区分：

```text
已确认结论
当前工作假设
已确认的改造细节
已否决或被替代的方案
对后续步骤的约束
未解决问题
```

最重要的规则：

> Assistant 提出但用户没有明确确认的方案，不得仅因用户没有反驳就写成“已确认”。

信息权威顺序：

```text
用户最新明确更正
>
用户明确确认的选择
>
后续讨论明确以其为前提的工作方向
>
Assistant 提出的建议
>
模型自行补全的推断
```

最后两类不能直接进入“已确认结论”。

### 6.3 当前不做 Approval Card

Approval Card 会引入：

- Draft / Approved / Rejected 状态；
- 修改后是否重新失去确认；
- 谁能确认；
- 撤销确认；
- 未确认 Artifact 能否引用；
- 新的操作记录和测试组合。

当前更轻量的方式是，Artifact 生成后由 Assistant 普通回复提示用户核对：

```text
已生成阶段总结。

请重点核对：
1. 哪些内容被列为“已确认”；
2. 哪些仍是“当前工作假设”；
3. 哪些被列为“未解决问题”。

确认分类无误后，再在其他 Thread 中引用这份文档。
```

用户可以直接指出错误并重新生成修正版。

用户在下游主动选择 `@Artifact`，可以被理解为一次显式使用决策，但不等于正式内容审批。

### 6.4 优先投入 Evaluation

Outcome 的首要投资应是评测，而不是状态机或复杂 UI。

至少覆盖：

- 用户未确认时，不得声称已确认；
- 用户后续更正必须覆盖旧内容；
- 当前分支的新决定应覆盖继承背景的旧决定；
- 未解决冲突不得擅自拍板；
- 已否决方案不能混入当前改造细节；
- 未讨论内容不得被补成既定方案；
- 显式引用中的重要约束不得遗漏。

当评测显示普通 Markdown Prompt 已足够稳定，就不需要专用 Outcome 工具。

当错误率仍高，再比较：

```text
方案 A：普通 Markdown Prompt
方案 B：严格 Outcome Prompt
方案 C：先提取结构化工作状态，再渲染 Markdown
```

---

## 七、`@Thread` 的有效时间线与差量语义

### 7.1 什么是有效时间线

一个 Fork Thread 的上下文通常由两部分组成：

```text
1. 创建时冻结继承的父级消息
2. 当前 Thread 自己新增的消息
```

暂定有效时间线为：

```text
冻结继承的消息
+
当前 Thread 自己未被替换的 completed 消息
```

默认不包含：

- 子 Thread；
- 兄弟 Thread；
- 已 superseded 的旧 Message；
- 正在生成的 Message；
- 生成失败的 Assistant Message；
- 其他 Project 的内容。

`stopped` 消息是否纳入需要后续研究。为保证首版可预测性，默认只自动纳入 `completed` 更稳妥。

### 7.2 应计算与当前 Thread 的消息差量

如果未来实现 `@Thread`，不应重复注入当前 Thread 已经拥有的共同祖先消息。

例如：

```text
主线 A：M1 → M2 → M3

分支 B：继承 M1、M2、M3；新增 B1、B2、B3

当前分支 C：继承 M1、M2、M3；新增 C1、C2
```

C 中引用 B 时，只需要带入：

```text
B1、B2、B3
```

服务端可以按 Message ID 计算确定性集合差：

```text
sourceEffectiveMessageIds
-
currentEffectiveMessageIds
=
sourceDeltaMessageIds
```

这不是模型语义 Diff，而是结构上的消息差量。

它可以：

- 避免重复共同祖先；
- 降低上下文冗余；
- 保持行为可测试；
- 更接近“把另一条分支新增讨论带进来”的用户理解。

### 7.3 默认不自动总结差量

短差量可以直接引用原始消息。

当差量很长时，不应在后台静默生成不可见摘要。更可预测的交互是：

```text
该 Thread 有较多新增消息，无法完整直接引用。

请选择：
- 引用最近一轮；
- 选择具体 Message；
- 先生成 Markdown 总结。
```

这也是 `@Thread` 应排在 `@Artifact` 和 `@Message` 之后的原因。

---

## 八、MVP 明确搁置清单

当前明确不进入首轮 Spec 和开发：

```text
depends_on
项目依赖图
传递性过期传播
循环依赖检测
独立 ThreadOutcome 实体
Thread 发布状态
Handoff 实体和状态机
Convergence / 汇总实体
Outcome Approval Card
复杂 Outcome 审批状态
自动 Project Memory
完整 Operations Ledger
用户可见 Activity Feed
Agent 自动读取 Project Activity
递归总结 Thread 子树
@Thread 后台静默总结
完整 Event Sourcing
```

Artifact Revision 也不是最小 `@Artifact` 的硬前置；只有支持更新同一 Artifact 时才进入实现。

---

## 九、重新启动各能力的触发条件

### 9.1 启动 `@Artifact`

当以下问题反复出现：

- 用户需要把一份生成文档带到另一个 Thread；
- 用户频繁复制粘贴 Artifact 内容；
- Project 中 Artifact 难以寻找和复用。

### 9.2 启动 `@Message`

当用户频繁需要引用一条准确结论，但为此生成 Markdown 过重。

### 9.3 启动 `@Thread`

当用户频繁需要另一条 Thread 的新增讨论，并明确表示不愿先生成 Artifact。

### 9.4 启动 Outcome 专用能力

当普通 Markdown 总结在 Evaluation 或真实使用中持续出现：

- 错误确认；
- 旧方案残留；
- 冲突遗漏；
- 重要约束遗漏；
- 无依据补全。

### 9.5 启动 Approval Card

只有当 Outcome 被高频用于重要下游决策，并且简单文字核对仍然不足时再做。

### 9.6 启动 Artifact Revision

当用户开始明确要求：

- 更新同一份 Artifact；
- 查看 Diff；
- 回退版本；
- 多 Thread 同时修改。

### 9.7 启动 Operation / Activity

当出现多用户协作、复杂版本历史、审计、恢复或“项目最近发生了什么”的明确需求。

### 9.8 启动完整 Memory

另开专题研究，不能作为 Project MVP 的顺带功能。

---

## 十、当前需要保留的验收不变量

即使采用最小开发节奏，后续实现仍应遵守：

1. Contract、File、Artifact、Thread、Message 的职责必须清晰；
2. 用户原始 File 不被 Agent 静默覆盖；
3. Artifact 保留创建来源；
4. `@` 必须是结构化引用，而不是仅保存一段显示文本；
5. 服务端必须校验引用对象属于当前用户和 Project；
6. 历史引用不能因来源后续变化而静默漂移；
7. 未实现 Artifact Revision 前，一个 Artifact 本身应视为一次不可变生成结果；
8. Outcome 不自动写入 Contract 或 Memory；
9. 聚合多个引用只是普通模型任务，不产生隐含领域状态；
10. `@Thread` 若未来实现，只注入相对于当前 Thread 的必要消息差量，不递归包含子树。

---

## 十一、与前序 Research 文档的关系

- `01-project-workspace-research.md`：保留完整 Project 问题空间和总体机制研究；
- `02-dependent-thread-handoff-research.md`：保留复杂依赖型方案的探索过程；
- `03-reference-and-outcome-preliminary-research.md`：记录方案由依赖图收敛到 Reference + Outcome 的过程；
- **本文 `04-project-mvp-scope-and-roadmap.md`：冻结当前产品范围与开发节奏，当前决策以本文为准。**

前序文档中的 `depends_on`、独立阶段成果、专门汇总和完整 Operation 方案不进入当前 MVP。

---

## 十二、下一步

当前最合理的下一步不是继续扩大 Project 架构，而是：

1. 将本轮 Research 作为设计储备归档；
2. 继续真实使用现有 Thread/Fork/Artifact 功能；
3. 记录跨 Thread 复制、查找和总结的真实摩擦；
4. Project 正式启动时先写最小 Spec：Target、Instructions、Files 区域、Artifacts 区域；
5. 完成最小 Project 后，再根据真实使用决定是否优先实现 `@Artifact`。

当前 Product Core 冻结为：

```text
Project Contract
+ Files
+ Artifacts
+ Threads / Messages
```

Structured References 是下一层增强，顺序为：

```text
@Artifact
→ @Message
→ @Thread（仅在证明确有必要后）
```
