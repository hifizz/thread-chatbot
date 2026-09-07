## Context

基于 main `7da00eaba9fb116a4ff4612b08005f51e886cd45`，将 #93 的可用行为选择性移植到独立分支。#93 HEAD 为 `6b4019fb3f764e6b89cb8029a6dd4cf3afe4e74b`，其静态审查与最小依赖替身实验不能代替浏览器、真实数据库及模型验收。

main 已有有序 MessageContentInput、ThreadComposerDraft、messages.parts JSONB、Artifact 插入流程、normalized Store 和事务命令。旧 CLAUDE.md 的整树存储描述与现有 normalized 代码并存；本设计以现行 v1 实现为集成对象，不恢复旧整树模型。

## Goals / Non-Goals

**Goals:** 数据结构与不变量先行；一个内容协议贯穿操作入口；保持所有 Part 身份与顺序；在同 Project 内复用固定 Markdown Artifact；按官方 Lexical 机制重构输入框；每个阶段留下可核验的证据。

**Non-Goals:** 不做全项目重写，不增加通用消息插件注册框架、数据库引用图、Artifact 版本表、Slash、跨 Project 访问或自动摘要。暂不承诺持久化未发送草稿跨浏览器刷新恢复；刷新恢复的必验范围是已发送消息。

## Decisions

### 1. 内容 Schema 是协议定义，实体边界不变

| 对象 | 权威数据与关系 |
|---|---|
| Project | 用户归属与资源范围 |
| Thread | Project 内时间线、parent、来源消息与冻结 forkContext |
| Message | Thread 内提交记录；有序 parts 为正文事实来源 |
| Artifact | id、projectId、threadId、sourceMessageId、kind、title、content；同 ID 为固定产物 |
| Artifact 引用 Part | 指向 Artifact；位置来自 Message.parts 数组，重复提及允许重复出现 |
| ThreadComposerDraft | 仅 UI 的未提交有序内容与本地节点身份，不新增数据库实体 |

复用并扩展 messageContentPartInputSchema：text、file、quote、artifact-reference。Zod Schema 为唯一运行时协议定义，类型由 z.infer 推导；不手写第二套可漂移的 MessagePart 类型。Artifact 引用的网络输入严格仅 type 与 artifactId。FileReference 与 Quote 的现有协议继续使用。

引用持久化数据沿用 #93 的 schemaVersion: 1、artifactId、冻结 title/kind/threadId/sourceMessageId；引用 Part 不保存正文，正文从 Artifact 读取，源工具记录仍保留原样。客户端标题只供显示，不能作为权限或正文依据。未知版本和非法引用明确报错，不静默转成文字。

规范化只允许合并相邻 text、忽略零长度 text；不得 trim 掉有意义的空格、跨 Part 拼接、按类型重排或去除重复引用。保持现有“至少一段非空问题文本”要求，纯引用消息暂不开放。Part 总数及文件数沿用当前限制。

替代方案：将 Lexical JSON 直接作为消息协议会绑定编辑器；同时保留 text/files/parts 会产生多个事实来源，均不采用。

### 2. 一个内容核心，显式转换边界

沿用现有目录与函数职责，不新增 ContentService/ResolverRegistry：
- contracts/message-content.ts：Schema、草稿导出、持久消息恢复及纯内容派生；使用穷尽分支拒绝遗漏类型。
- contracts/composer.ts：完整有序草稿；localId 等 UI 信息不进入网络和模型。
- application 的单一用户内容解析入口：在调用者已有事务内解析文件/Quote/Artifact 的合法性和权威数据。
- persistence/artifact-repository.ts：Project 范围批量读取并返回来源状态；不以 requireCompleted 布尔值隐藏业务模式。
- application/artifact-reference-context.ts：固定模型格式、前向去重与展开；contracts 不承载请求内 seen 集合。
- 前端唯一 codec：Lexical 与有序内容双向转换；正常业务组件不自行 filter/map 重拼消息。

单一核心指集中内容含义与转换规则，不把 SQL、DOM 和模型调用放入同一个万能函数。

### 3. 固定操作协议，保留 v1 网络格式

内部命令示意（省略模型、幂等 ID 等独立字段）：
```ts
sendMessage({ threadId, content: MessageContentInput })
editMessage({ messageId, content: MessageContentInput })
forkThread({ sourceMessageId, firstTurn?: MessageContentInput })
retryMessage({ assistantMessageId })
```

HTTP 请求仍是现有 command 字段加 parts；只有网络边界将 content.parts 放入已有 command。禁止内部同时接受 text/files/parts?，也不支持两种 HTTP 内容字段并行。

firstTurn 缺席明确表示空分叉；存在则校验完整内容，不依赖额外 text 字段。现有划选分叉需要 Quote 时，在 UI 草稿创建阶段通过统一操作加入一次，命令层不再盲目 prepend。不借此次变更开发新的无选区分叉产品入口。

编辑创建替代消息，保留现有 replacesMessageId/supersededAt 与子 Thread 冻结历史；用户可删除已有 Quote；胶囊正文、来源和已有 comment 只读，不提供拖动、排序、复制或新增 Quote。保留父 Thread 首问 Quote 时，依据原消息快照校验，不重新限制成当前 Thread。引用和附件不得因编辑恢复丢失或移动。

重试使用已保存用户消息。发送的网络重试复用同一命令 ID；保留已有幂等和事务实现，不增加新的调度机制。

### 4. 权限、完成状态与不可变性

调用者先验证用户拥有目标 Project/Thread，再在该事务内批量加载同 Project Artifact；仅新的引用选择要求来源 completed。未知 ID、跨 Project/跨用户、未完成来源在付费模型调用前拒绝，事务不留下半条消息。新 Project 不接受旧 Project 的 Artifact 引用。

历史回放和编辑保留的旧引用保持原 ID 与快照语义，不切换到同名或重新生成的 Artifact。同 ID 的 title/kind/content/来源不做原地业务修改；内容更新产生新 ID。来源被替代或归档不应使历史正文消失。Project 删除继续沿用整 Project 生命周期；新增单项删除能力之前必须先定义被引用产物的保留策略。

MVP 用受控写入路径和真实数据库不变量测试保障不可变性，不为假设中的修改功能新增触发器或版本表。若发现当前其他写路径覆盖同 ID 内容，先归位该写路径。

### 5. 单向编译、稳定标记与两层预算

在实际选定的 forkContext、当前历史与附件处理结果上从前往后扫描。只有完整、非临时且最终 SDK 会保留的匹配源工具正文，或前文已经展开的同 ID 引用，才计入 seen。保留 #93 的身份与正文核对用例，不能仅凭标题或 Thread 判断。

首次需要时展开权威正文，后续固定为：
```json
{"contextType":"artifact-reference","artifactId":"固定ID","title":"冻结标题","previouslyIncludedInContext":true}
```
不得带轮次、时间或位置索引，不修改前文或持久化 Parts。裁剪后的首次存活引用须补全文。该策略只承诺引用编译的前缀稳定，不承诺现有附件策略、动态设置或提供商缓存一定稳定。

预算分两层：
1. 接收预算沿用 #93：最多 20 次 Artifact 提及，单消息不同 Artifact 的 title/content 合计最多 200,000 个 JavaScript 字符；重复提及保序，唯一正文计一次。它是输入防护，不是 token 估计。
2. 整轮预算由最终模型请求组装处统一检查，包含 system、工具定义、历史、附件/多模态、引用及输出预留。复用已有模型能力/限制数据及 token 估算能力，不引入第二套模型注册表。已知超限在模型调用前返回可读错误，不静默截断。

T3 必须先核实各类输入的估算能力；无法可靠估算时显式标记 budget 状态 unknown，并处理提供商超限错误，不能把字符数冒充 token 或宣称已通过总预算。精确估算和提供商账单不作为本提案已完成证据；增加模型支持时补对应能力。内部统计只记录展开/复用 ID、计量方式及用量，不记录正文到额外日志。

### 6. Lexical 按官方组件组合，单一状态归属

MessageComposer 组合附件区、LexicalComposer 和按钮；按需要提取 ArtifactReferenceNode、ArtifactMentionPlugin、SubmitPlugin、DraftSyncPlugin 和一个 codec 文件。这些是官方 Node/React Plugin/Command 机制中的业务实现，不增加 EditorAdapter、插件管理器或自定义状态机框架。

Lexical 负责活动编辑器文档、选区、输入法及撤销栈；草稿 Store 保存完整有序 Parts 及上传状态以支持列/画布切换。文件可在视觉上放在附件区，但其 localId 和序列位置必须保留，不能恢复时按类型分组。编辑器本地更新只通知 Store；仅加载草稿、切换身份及显式重置时重新导入，不让受控 effect 持续重写 root。发送成功只清除对应提交快照；发送后用户继续输入或切换 Thread 不得被迟到结果覆盖。上传状态变化不能改变 Part 位置。

Artifact 候选从已有 normalized Store 的资源切片订阅；query 为 null 不搜索；无关流式更新不重新构建候选。历史引用按钮通过明确导航回调工作，不依赖草稿 Provider。必需上下文缺失应显式暴露接入错误，不静默建立替代 Store。

复用官方 PlainText/History/OnChange 及 Typeahead；冻结胶囊使用官方行内 DecoratorNode，isKeyboardSelectable 返回 false，左右键在胶囊两侧移动。点击通过公开 selectNext 将光标放到胶囊右侧；不使用仍可进入光标、输入可替换整块的 token TextNode。候选首项显示可见 outline ring，焦点保留在输入框。使用公开序列化/剪贴板接口保留 ID；跨 Project 粘贴仍由服务端校验。普通 @ 字符不自动升级成业务引用。

不移植覆盖 Lexical anchor/firstChild 定位的 !important、不读取或改写其私有字段，不常驻逐帧循环对抗官方定位。如果公开能力无法满足底部翻转、窄列、画布变换、软键盘，停止该问题的变通实现，提交最小复现、版本、官方依据与可选取舍并向用户求助。不能以删除已确认交互来规避验收。

官方依据：
- https://lexical.dev/docs/react/create_plugin
- https://lexical.dev/docs/react/plugins
- https://github.com/facebook/lexical/blob/v0.45.0/packages/lexical-react/src/LexicalTypeaheadMenuPlugin.tsx
- https://github.com/facebook/lexical/blob/v0.45.0/packages/lexical-playground/src/plugins/MentionsPlugin/index.tsx
- https://github.com/facebook/lexical/blob/v0.45.0/packages/lexical-playground/src/nodes/MentionNode.ts

### 7. 两轮审查归并

| 首轮项 | 严格审查对应 | 工作包 |
|---|---|---|
| 核心领域模型 | 已确认应保留 | T1 |
| 内容源一致 | P1 多输入导致分叉首问丢失 | T1 |
| 编辑有序 | P2 引用前移及 Quote/File 重组 | T1/T4 |
| 模块归位 | P2 协议承载业务、查询绕开 Repository | T2/T3 |
| 不可变性 | 后续约束，非已发生覆盖缺陷 | T2 |
| 去重与整体预算 | 保留去重，补整体预算责任 | T3 |
| 前端与真实验证 | P2 混合 Context、内部定位覆盖 | T4/T5 |

## Risks / Trade-offs

- [完整有序草稿与附件区分开显示容易重排] → 用交错 Part、重复引用、Quote 删除等反例测试 codec 与真实编辑命令。
- [官方浮层能力与已确认交互存在差距] → 最小复现并求助；不以自定义内部补丁填补。
- [长历史或多模态 token 不可精确预估] → 明确计量方式与 unknown 状态、统一处理超限；不承诺预算准确性。
- [模型请求格式变更影响一次缓存前缀] → 固定编译格式、比较最终 SDK 消息；真实缓存命中另行记录。
- [未运行真实 E2E 却把 mock 当作成功] → T5 独立记录环境、SHA、结果及阻塞，缺证据保持未完成。
- [main 持续变化] → 实现开始与合并前核对基线，保留用户已有修复，不覆盖其他功能。

## Migration Plan

1. 提案已先行提交到新分支，当前按任务实施；#93 保持参考，不关闭或合并。
2. T1 固定协议、操作入口与测试，先打通文字加一个 Markdown 引用的纵向链路。
3. T2/T3 归位服务端逻辑；T4 接入新编辑器，不整体复制旧 Composer。
4. 已有 text/file/quote 消息继续可读、可编辑、可重试；如环境中存在 #93 schemaVersion:1 引用，也保留读取能力。
5. 同批发布内部调用与实现，HTTP v1 parts 兼容；无需迁移。若实际出现 schema 变更，遵守 develop 集中生成迁移流程。
6. 回滚不得退到无法识别已保存引用的服务端；出现此风险时先关闭新引用入口并保留兼容读取，再修复，不能删除引用或正文。

## Open Questions

没有阻塞提案的产品问题。以下是实现前需取证的技术检查，不代表允许自行改变需求：
- Lexical 0.45.0 公开浮层能力是否通过画布/软键盘验收。
- 当前最终请求组装处可用的模型限制与多模态计量能力；未知项如实记录。
- 真实数据库和模型验收环境是否可用；不可用时明确阻塞。

## 已确认的 MVP 收敛

用户确认：本期已有 Quote 为只读胶囊，可删除；不提供排序、拖动、复制、新增 Quote 或逐项修改评论。胶囊保持已有相对顺序，不锁定文字编辑后的绝对字符位置。旧版 `{text}` Quote 仅在编辑时允许回传原快照，服务端做原顺序子序列匹配；发送/分叉/新建拒绝新增旧版 Quote。本期编辑规则以此只读范围为准。

Annotation 胶囊、划选后提问及 hover/点击列表为后续独立能力，本期不实现。Artifact 的 @ 选择仍是本次核心功能，不受“编辑时不新增 Quote”限制。
