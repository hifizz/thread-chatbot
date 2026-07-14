# bubble-composer 划选气泡内输入框

## ADDED Requirements

### Requirement: 两条提交路径的消息形状

划选气泡 SHALL 提供可选的单行自增高输入框（placeholder 提示可留空）。**输入后提交**：新分支的第 1 条消息 SHALL 是该问题（user 角色原文），第 2 条 SHALL 是随即流式生成的 assistant 首答——不经过 composer 预填。**留空提交**：行为与现状完全一致（空分支打开、composer 预填代拟问题、用户回车确认后才发送）。两条路径下游消息形状一致（首条恒为 user），请求组装（net/prompt.ts）零改动。

#### Scenario: 带问开分支

- **WHEN** 用户划选文字、在气泡输入框输入「这个和 XX 有什么区别？」并按 Enter
- **THEN** 新分支列打开，第 1 条消息即该问题（user 气泡），assistant 首答开始流式；composer 为空（无预填）

#### Scenario: 留空开分支（现有路径不回归）

- **WHEN** 用户划选文字、不输入任何内容，按 Enter 或点按钮
- **THEN** 空分支打开、composer 预填代拟问题、消息区为空、无 /api/chat 请求——与现状逐项一致

### Requirement: 键位语义与 IME 守卫

输入框 SHALL 支持：Enter 提交（带问或留空均开完整分支列）、Shift+Enter 换行、⌘/Ctrl+Enter 提交且保留来源列（keepSource 放置）、Esc 交由壳层关闭链关闭气泡（输入内容随气泡丢弃、无消息入树）。Enter 处理 SHALL 有 IME 守卫（`isComposing` 或 keyCode 229 时不提交、不 preventDefault），中文输入法组合态回车仅上屏。

#### Scenario: IME 组合态回车

- **WHEN** 中文输入法组合中（如拼音未上屏）在气泡输入框按 Enter
- **THEN** 仅完成上屏，不开分支、不发请求；再次 Enter（非组合态）才提交

#### Scenario: ⌘Enter 保留来源列

- **WHEN** 用户在输入框按 ⌘+Enter 提交
- **THEN** 分支以 keepSource 放置（来源列保留、新列开在紧邻右侧），语义与 ⌘ 点按钮一致

### Requirement: 按钮文案随态切换

气泡按钮文案 SHALL 按优先级切换：列条 override 选中 →「开启并替换『{列名}』」；⌘/Ctrl 按住 →「在右侧新列打开」；输入框非空 →「带着问题开分支」；默认 →「开启分支讨论」。按钮点击与 Enter 提交走同一提交函数。

#### Scenario: 输入中文案切换

- **WHEN** 用户在输入框键入第一个字符
- **THEN** 按钮文案变为「带着问题开分支」；清空后恢复「开启分支讨论」

### Requirement: 气泡内滚动事件不自毁

气泡的 document 级 capture scroll 监听 SHALL 放行事件 target 位于 `.sel-bubble` 内部的滚动（textarea 自增高、内部滚动）——仅页面/列表真实滚动才关闭气泡。输入长问题触发换行/内滚时气泡 SHALL 保持打开、输入不丢失。

#### Scenario: 长问题输入不丢

- **WHEN** 用户在气泡输入框输入超过一行宽度的问题（触发 textarea 自增高）
- **THEN** 气泡保持打开、已输入内容完整保留

### Requirement: kickoff 预填文案

留空路径的 composer 预填文案 SHALL 更新为：「请结合上下文，展开讲解『{锚点原文}』」（衔接上文的意图显式置于句首；服务端分支 system 的「结合上文展开」保持不变）。

#### Scenario: 预填文案形状

- **WHEN** 留空开分支后查看 composer 预填
- **THEN** 文案为上述模板（含「请结合上下文」与锚点原文）

### Requirement: 异步分支标题

分支首答完成后，系统 SHALL 异步生成 4–8 字的语义标题替换默认标题（锚点截 13 字）：请求携带锚点原文与首轮问答，经服务端小路由调用生成模型；成功则经 store 原子更新该分支标题（列头/⌘K/画布/面包屑同步显示），并随整树防抖存盘持久化；失败 SHALL 静默保留默认标题。每个分支 SHALL 至多自动生成一次（用户后续在会话列表重命名树不受影响——那是树级 custom_title，两者层级不同）。

#### Scenario: 首答完成后标题替换

- **WHEN** 分支首答流式完成
- **THEN** 稍后该分支标题变为 4–8 字语义标题（非锚点截断），刷新页面后仍是新标题

#### Scenario: 生成失败静默

- **WHEN** 标题生成请求失败（网络/服务端错误）
- **THEN** 分支标题保持默认（锚点截断），无错误弹窗，控制台留警告

### Requirement: 继承段上下文预算

`buildRequestBody` 的继承段 SHALL 受字符总预算约束（常量定义于 constants/，默认 ~6000）：超出预算时以完整消息为单位**从最旧开始丢弃**（SHALL 至少保留最近 1 条继承消息）；发生丢弃时 SHALL 在继承段最前插入一条说明消息（user 角色，如「（更早的 N 条上文已省略）」）。当前会话自身的消息不参与截断。

#### Scenario: 深树请求不爆炸

- **WHEN** 在祖先链累计正文远超预算的深层分支中发起请求
- **THEN** 请求的继承段总字符数 ≤ 预算 + 说明消息，最旧的祖先消息被省略且有省略说明；最近的上文完整保留

#### Scenario: 预算内不截断

- **WHEN** 祖先链正文总量在预算内
- **THEN** 继承段与现状完全一致（无说明消息、无丢弃）
