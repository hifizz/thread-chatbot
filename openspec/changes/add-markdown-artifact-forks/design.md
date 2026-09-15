## Context

本设计对应用户已确认的第一阶段：在 Markdown Artifact 上划选并开启 Thread，不实现文档更新。代码核对基线为 `main@00e1117ccfb43fd5fab654ac7f6814881c9eab33`。

当前事实：

- 生产阅读入口为 `StoreBoundProjectPanel → ProjectPanel → MarkdownBody`；`ArtifactDrawer` 是旧 harness 适配器，不应作为新功能主入口。
- `useAssistantTextSelection` 是全局选区采集入口，但通过 `.msg-list`、`.message` 识别来源，无法识别 Artifact 阅读区。
- Fork 已有服务端事务、幂等命令、脚注分配及冻结 Message ID 的 `forkContext`。
- `contracts/quote.ts` 已定义 Artifact Quote；需要扩展分支首问的严格来源校验，而非新增 Quote 表。
- `compile-model-context.ts` 与 `artifact-reference-context.ts` 已负责历史和引用展开。当前引用规范要求按实际完整内容判定去重，不能仅凭 ID 或标题假定全文已经发送。
- `openspec/specs/domain/spec.md` 是本次修改的主规范；引用和 Artifact 的较新契约仍位于已有 change 中。旧 `add-markdown-artifacts` 中 whole-tree JSON、删除旧 Artifact、字符截断描述不作为本次实现依据；采用现有规范化持久化、固定 Artifact ID 和完整上下文规则。

## Goals / Non-Goals

**Goals:**

1. 用户可从文档选区进入分支，在分支中看到明确来源，并返回原文。
2. 消息正文与 Artifact 共用选区交互，来源身份明确，不串线。
3. Thread 来源长期可回放；用户消息内 Quote 可删除，两者互不替代。
4. 桌面、手机、刷新、空分支、后代分支和网络重试具备明确行为。

**Non-Goals:**

不做文件修改、版本编辑、To-Do/工作流引擎、自动成果回写、整篇无选区开分支、任意父节点选择、公开分享页写操作、上传附件或 Code/Note 划选。第一版不新增独立 Artifact 分支列表产品页面，使用现有分支树和来源入口导航。

## Decisions

### 1. 用户流程与父节点固定

打开 Artifact → 划选正文 → “此处提问” → 可选输入问题 → 创建分支 → 阅读回复 → 点击来源返回文档选区。

父 Thread 始终为 `artifact.threadId`，上下文截止消息为 `artifact.sourceMessageId`。即使用户正在浏览兄弟 Thread 或从项目列表打开文档，也不取当前焦点列作为父节点。列放置仍由现有 placement 模块处理；来源列未展开时由导航编排恢复所需来源路径，再按既有列数约束打开子列。

比较过“挂在当前焦点 Thread”：它需要独立选择上下文截止点和解释跨来源关系，留待后续需求。本次仅允许来源位于当前有效时间线且已 completed 的 Artifact；来源被替代时已有分支仍可读取，新建分支明确拒绝，不自动改挂新消息。

有问题：事务保存 Thread、最终用户 Parts 和 assistant 占位，提交后由现有生成机制启动。无问题：只创建空 Thread，在 Composer 预填可删除 Quote 与代拟问题，不调用模型。提交失败保留选区快照和问题；同一请求重试沿用 commandId，改变内容则使用新 commandId。

### 2. 数据存储最小扩展

| 位置 | 字段/职责 |
| --- | --- |
| `threads` | 新增 nullable `forkArtifactId`，指向 `artifacts.id` |
| `threads` 现有字段 | 复用 `parentId`、`forkMessageId`、`forkAnchor`、`anchorText`、`forkContext`、脚注和 depth |
| `artifacts` | 保留原 ID、标题、正文和来源，不原地修改，不复制到新 Thread |
| `messages.parts` | 仅在用户最终保留 Quote 时保存现有 Artifact `data-quote` |
| 前端临时状态 | rect、DOM 根引用、焦点、展开状态、未提交选区，不进数据库 |

`forkArtifactId = null` 表示现有消息正文分支；根节点也必须为 null。非 null 时，Artifact、来源 Message 和父 Thread 必须属于同一 Project，且两条来源 ID 与 Artifact 权威来源相等。外键阻止引用目标被单独删除；不得用 `ON DELETE SET NULL` 把 Artifact 分支悄悄变成正文分支。项目整体删除继续按依赖顺序处理，本次不改变删除权限。

增加 `(projectId, forkArtifactId)` 查询索引；来源关联由服务端事务验证。DTO、repository mapper、客户端 store/视图适配、导出及现有分享序列化必须保留来源区分，旧记录读为 null。不把 Artifact 锚点画到来源消息正文上。来源 Message 无需新增可变分支列表。

Artifact ID 在本期就是固定内容身份；后续引入版本时迁移为该原始版本，不能让历史 ID 追随最新版。本期不预建 Document/Revision 表，也不添加占位版本字段。

### 3. 请求只描述来源与选区

复用 `POST /api/thread-chat/v1/threads/{threadId}/forks`。新请求使用判别联合：

```ts
type ForkTarget =
  | { type: "message"; anchor: TextAnchor }
  | { type: "artifact"; artifactId: string; anchor: TextAnchor }

// 保留既有 commandId、threadId、sourceMessageId、modelId、
// generationSettings 与 firstTurn 的实际类型，不另创 question-only 协议。
type NewForkFields = { target: ForkTarget }
```

`firstTurn` 继续使用有序 Parts 合同与既有 Message ID，不增加平行的 question 字段。原 `anchorText + anchor` 请求由兼容入口规范化为 message target；新 target 与旧字段同时出现应拒绝歧义。持久化只保留既有锚点字段和新增 Artifact ID，不同时存另一份 target JSON。

服务端按现有锁顺序与 `executeIdempotentCommand`：校验父 Thread/项目 → 查询 Artifact 及来源 → 检查类型、completed、归档只读、有效时间线与身份 → 验证选区 → 冻结上下文 → 创建 Thread/可选消息 → 返回 DTO。付费调用发生在事务之后；非法输入无半成品写入。客户端提交的 Artifact 标题、全文、来源状态等额外权威字段由严格 Schema 拒绝。

### 4. 选区绑定渲染文本，身份校验与文字定位分离

复用 `TextAnchor`：exact、prefix、suffix，position 为加速线索；保持现有字符长度限制。选区必须完全落在一个可选内容根中，跨 Artifact、跨消息、包含工具条或输入框的选区不接受。

实现前先为 Markdown 可选文本建立客户端/服务端一致的纯文本规则及固定样例：标题、粗体、链接可见文字、列表、表格单元格、代码、换行、中文与 emoji。UTF-16 位置口径与现有 DOM Range 采集一致；排除脚注按钮、复制按钮等界面附加文字。Mermaid 图形与公式插件生成的重复辅助 DOM 不作为新 Artifact 选区目标；包含这些非规范化区域时提示选择普通文本，代码源码视图中的普通文字按既有文本规则处理。

服务端先在规范化文本中验证 position 的 exact 与上下文，再进行 exact/prefix/suffix 消歧；仍无唯一匹配则拒绝，不用 fuzzy 结果授权一个新 Fork。不得用 raw Markdown 的 includes 或源码下标验证渲染选区。正文 Quote 的既有快照规则不因这次改造而扩大为全局重新解析。

服务端验证接受的 exact 原样保存，不能悄悄纠正用户快照。无法可靠支持的渲染构造必须明确拒绝，不能声称已经定位成功。

### 5. Quote 与 Thread 来源各司其职

分支 UI 从 Thread 来源展示“源自《文档标题》”及导航。用户消息中的 Quote 则严格来自实际 Parts：保留时保存，删除后不恢复。

首问预填 Artifact Quote 必须与当前 Thread 的 `forkMessageId`、`forkArtifactId`、`forkAnchor`、`anchorText` 精确一致。留空开分支后第一次发送，同样走该校验。不得借此允许任意跨 Thread Quote。编辑首问沿用现有只读快照匹配、可删除和替代 Message 规则。

这扩展了 `add-thread-chat-message-quotes-v2` 中首问只接受 Message 来源的范围，但保留其“Quote 可删除”“不合成隐藏 Quote”“无问题不启动生成”等约束。无 Quote 的分支可显示独立的来源导航组件，不在消息中伪造引用块。

### 6. 模型全文来自冻结历史，选区来自实际 Parts

保持 `forkContext` 原序 Message ID，不塞 Artifact ID、不重算历史。因为父节点固定为 Artifact 来源 Thread，产物消息天然处于继承范围；统一上下文编译器确保该消息所属的已完成 Artifact 标题和全文成为实际模型输入，即使来源是 Artifact-only 消息。

若最终 SDK 消息已经完整包含同一 Artifact 的权威正文，不再展开；若只有工具 ID/标题或工具内容被剔除，则在来源消息对应的固定历史位置展开全文。按来源消息/产物固定顺序处理，不能因后来某个子分支选择不同 Artifact 而重写共同历史。显式 `@artifact` 继续共用现有按实际内容去重规则。通过真实最终模型消息验证，不能只检查中间 DTO。

选区文本与批注仅从实际 Quote Parts 编译，位于继承历史之后；不从 `forkAnchor` 补到 system 或隐藏 user 文本。删除 Quote 不删除正常继承的整份文档。空分支后发送、刷新、编辑、重试、再从子分支开分支均使用相同的确定性上下文路径，不另建 Thread 专属全文副本。

新建与已有分支回放分开：新建来源必须有效；已有冻结引用在来源 superseded/归档后仍读取旧对象。引用缺失明确报错，不偷换同名产物。沿用最终请求预算：不做 Child 专属截断；已知超限在模型调用前失败，未知计量不冒称通过，提供商超限返回可读错误。

### 7. 模块与组件边界

| 模块 | 责任与改动 |
| --- | --- |
| `branching/selection/` | 在唯一监听器内抽出来源解析；让 SelectionInfo 使用 message/artifact 联合来源；复用工具条、提问、临时高亮、移动端草稿保护 |
| `orchestration/artifacts/` | 从 ProjectPanel 抽出 ArtifactDetail；来源定位、等待渲染、恢复选区 |
| `net/commands/` 与工作区编排 | 网络提交、幂等重试、成功后新列放置、失败草稿恢复；不塞入阅读组件 |
| `contracts/` 与 `persistence/` | 输入严格校验、DTO 映射、Thread 字段与来源查询 |
| `application/` | Fork 事务、首问 Quote 校验、冻结历史、最终上下文编译 |
| `constants/` | 新增文案、选择器或限制的唯一常量入口 |

组件安排：

```tsx
<ArtifactDetail artifact={artifact}>
  <SelectionSurface source={artifactSelectionSource}>
    <MarkdownBody source={artifact.content} />
  </SelectionSurface>
</ArtifactDetail>
```

ArtifactDetail 只展示文档和来源操作；SelectionSurface 只声明来源与内容根，不请求网络、不注册新的 document 监听器；MarkdownBody 保持渲染职责。SelectionBubble/Toolbar/QuestionDrawer 共用交互状态，支持配置动作。Artifact 场景本期仅开放“此处提问”，不把现有“本对话继续”错误绑定到焦点列；消息正文场景原行为保持。来源链接可复用既有引用展示/导航组件，必要时抽出小适配器，不创建第二套引用系统。

手机提问层与阅读面板共享选区快照，上层关闭时不得连带关闭文档或丢失问题；提交成功后收起遮挡新列的阅读/提问层，聚焦新列。所有操作等待服务端成功再视为已创建；请求结果丢失时同 commandId 重试恢复权威结果。

### 8. 返回来源与持久化高亮

点击分支来源：按 Artifact ID 打开详情 → 等待 Markdown 内容根就绪 → 定位 Anchor → 滚动到可见区域并短暂高亮。不能只定位来源消息卡片。多个 Artifact 可能包含相同句子，必须先锁定目标 Artifact 根再匹配。

现有 Artifact 分支标记通过 `forkArtifactId` 过滤后交给共享高亮逻辑，不修改 Artifact 正文。准确匹配失败时保留来源链接和引用原文并显示“未能准确定位原文”，不高亮猜测段落；不使用无限 MutationObserver 或无上限轮询等待渲染。共享阅读场景若尚不支持产物导航，允许明确提示不可定位，禁止退化成消息正文错误高亮。

## Risks / Trade-offs

- 渲染文本与源码不一致 → 先用固定语料验证统一文本规则，模糊匹配不用于创建授权。
- 用户删 Quote 后被重新注入 → 源自 Thread 的导航与 Message Parts 分开，最终模型请求做回归验证。
- 空分支没有首问导致文档缺失 → 全文来自冻结来源消息，首问 Quote 不是全文依赖。
- 两个组件同时监听选区 → 只有工作区原有监听器负责采集，SelectionSurface 只登记身份。
- 来源 superseded 后新建分支冲突 → 明确拒绝新建；旧引用继续回放，不擅自迁移来源。
- 不新增版本表意味着依赖 Artifact 不可变 → 固定 ID 不原地修改，未来版本功能用独立 Change 设计迁移。
- 增加字段涉及多处客户端映射 → 验收覆盖刷新、旧 Thread、分支树、导出及只读分享，避免半链路支持。

## Migration Plan

1. 本次只交付 OpenSpec；tasks 全部为后续实施工作，不修改主规范以宣称已上线，也不生成 migration。
2. 实施分支修改 Schema、DTO、命令、组件，在独立数据库使用 `pnpm db:push` 验证。
3. `develop` 的单一集成任务生成 additive migration：新增 nullable 字段、外键、根节点约束、索引；验证升级前旧数据和项目整体删除顺序。
4. 先升级数据库，再上线兼容读写服务端，最后启用客户端入口；只有相关迁移已生成并验证才能发布功能。
5. 出现问题先关闭新增创建入口；保留新增字段与兼容读取/上下文代码以回放已创建分支，不回滚删除字段或引用目标。
6. 实施验收完成后按 OpenSpec archive/sync 流程合并 delta 到主规范。若引用相关 change 在此之前已归档，应把本次首问 Artifact 扩展对齐至新的主规范，保留全部原场景。

## Open Questions

无阻塞产品决策。Markdown 文本转换的具体工具选择、可复用导航组件的位置由实施时的小规模代码验证确定，不能改变身份校验、Quote 删除或全文回放合同。整份文档讨论与文档修改继续留待后续 Change。
