## ADDED Requirements

### Requirement: Fenced code 使用 Shiki，inline code 保持轻量渲染

系统 MUST 仅对 Markdown fenced code block 启用客户端 Shiki token 高亮，并保持 inline code 的现有轻量样式和行为。

#### Scenario: 渲染带语言的 fenced code

- **WHEN** Markdown 包含一个声明受支持语言的 fenced code block
- **THEN** 稳定后的代码块显示该语言 grammar 生成的 token 样式
- **AND** 代码框仍显示语言标签和复制入口

#### Scenario: 渲染 inline code

- **WHEN** Markdown 包含反引号包围的 inline code
- **THEN** 系统使用现有 inline code 样式渲染
- **AND** 不为该 inline code 初始化或调用 Shiki

### Requirement: 流式内容先显示 plaintext

系统 MUST 在消息仍处于流式生成状态时将 fenced code 渲染为可读、可复制的 plaintext，并 MUST 仅在当前内容版本稳定后提交异步高亮结果。

#### Scenario: 代码块仍在流式增长

- **WHEN** fenced code 所属消息仍在接收增量内容
- **THEN** 代码块立即显示当前原始代码
- **AND** 系统不因每次 token 增量重复执行 Shiki 高亮

#### Scenario: 流式消息结束

- **WHEN** 消息由流式状态转为稳定状态
- **THEN** 系统异步高亮当前完整代码
- **AND** 在高亮完成前继续显示 plaintext

#### Scenario: 过期异步结果返回

- **WHEN** 旧代码版本的高亮在新代码版本之后完成
- **THEN** 系统忽略旧版本结果
- **AND** 不得用旧 token DOM 覆盖当前代码

### Requirement: 两条 Markdown renderer 共享高亮契约

系统 MUST 让 Thread Chat 与 assistant-ui 共享 highlighter 生命周期、语言规范化、主题家族、transformer 和 fallback 配置，同时 MUST 允许各 renderer 以自身状态来源判断 streaming。

#### Scenario: 同一代码在两条 renderer 中渲染

- **WHEN** Thread Chat 与 assistant-ui 渲染相同的稳定 fenced code
- **THEN** 两者使用相同的语言规范化和 grammar
- **AND** 两者使用共享主题家族中与自身表面匹配的主题分支

#### Scenario: assistant-ui 注册高亮 adapter

- **WHEN** assistant-ui Markdown renderer 渲染 fenced code
- **THEN** renderer 实际调用已注册的 Shiki adapter
- **AND** 不再仅因 adapter 未接线而回退到普通 code component

### Requirement: 支持受控语言、别名和安全 fallback

系统 MUST 仅加载配置中声明的浏览器语言和主题，MUST 规范化已声明的常用别名，并 MUST 将空语言、未知语言或加载失败的语言降级为 escaped plaintext。

#### Scenario: 使用语言别名

- **WHEN** fence 使用 `js`、`ts`、`sh`、`shell`、`zsh` 或 `md` 等已声明别名
- **THEN** 系统使用对应的规范 grammar 高亮

#### Scenario: 使用未知语言

- **WHEN** fence 声明一个未配置的语言
- **THEN** 系统以 plaintext 显示完整原始代码
- **AND** 保留原始语言标签
- **AND** 不抛出导致整条 Markdown 渲染失败的异常

#### Scenario: highlighter 初始化失败

- **WHEN** Shiki engine、theme 或 grammar 初始化失败
- **THEN** 受影响代码块降级为 escaped plaintext
- **AND** 复制按钮仍复制原始代码

### Requirement: 主题和 fence meta 不改变代码语义

系统 MUST 使用共享 light/dark 主题家族适配渲染表面，并 MUST 在支持的 fence meta notation 上增加展示标记，但 MUST NOT 修改复制文本或执行代码。

#### Scenario: 表面主题变化

- **WHEN** 支持主题切换的表面在 light 与 dark 之间变化
- **THEN** token 颜色切换到共享主题家族的对应分支
- **AND** 代码框布局与交互控件保持可用

#### Scenario: fence 包含受支持 notation

- **WHEN** fenced code meta 包含受支持的行高亮或 diff notation
- **THEN** 系统为对应行增加展示状态
- **AND** 复制结果仍是未注入展示标记的原始代码

#### Scenario: fence 包含未知 meta

- **WHEN** fenced code meta 无法识别
- **THEN** 系统忽略未知 meta
- **AND** 仍完整显示和复制代码

### Requirement: Thread Chat 所有 Markdown 表面获得一致高亮

系统 MUST 通过共享 `MarkdownBody` 让 Thread Chat 列视图、Canvas 展开视图和 Markdown Artifact drawer 获得相同的 fenced code 高亮与 fallback 行为。

#### Scenario: 静态 Artifact 打开

- **WHEN** 用户打开含 fenced code 的 Markdown Artifact
- **THEN** Artifact drawer 通过共享 renderer 异步高亮代码
- **AND** 不要求消息 streaming runtime 才能完成高亮

#### Scenario: 同一消息切换展示表面

- **WHEN** 用户在列视图和 Canvas 展开视图查看同一段 Markdown
- **THEN** 两个表面使用相同的语言、主题和 fallback 契约

### Requirement: 高亮完成后锚点必须重新稳定

Thread Chat 的 Markdown renderer MUST 在当前 source 的所有 fenced code 完成高亮或 fallback 后发出内容稳定通知，锚点系统 MUST 基于该通知重新解析并绘制当前持久文本锚点与脚注。

#### Scenario: 持久锚点所在正文包含代码块

- **WHEN** 页面恢复一条正文中含 fenced code 的持久分支锚点
- **AND** Shiki 随后完成异步 token DOM 渲染
- **THEN** 锚点系统重新查询当前 `.md-body` DOM
- **AND** 恢复高亮、脚注和点击标记
- **AND** 异步高亮的 React commit 不会覆盖已恢复标记

#### Scenario: 多个代码块以不同顺序完成

- **WHEN** 当前 Markdown source 包含多个异步高亮代码块
- **THEN** renderer 仅在当前版本所有代码块完成或降级后报告整体稳定
- **AND** 旧 source 的完成事件不触发当前 source 的稳定状态

#### Scenario: 高亮失败并降级

- **WHEN** 一个代码块高亮失败并显示 plaintext
- **THEN** 该代码块仍被计入已稳定
- **AND** 锚点重绘不会永久等待失败的 highlighter

### Requirement: 代码复制和 Markdown 安全边界保持不变

系统 MUST 从原始代码字符串执行复制，MUST 将代码内容作为文本处理，并 MUST NOT 因接入高亮而启用不受控 raw HTML。

#### Scenario: 代码包含 HTML 或脚本字符串

- **WHEN** fenced code 的内容包含 `<script>` 或 HTML 标签文本
- **THEN** 页面将其作为代码显示而不执行
- **AND** 复制结果与 Markdown 中的原始代码一致

### Requirement: 浏览器成本必须有界

系统 MUST 复用单例 highlighter 和已加载的 grammar/theme，MUST 使用受控的细粒度浏览器导入，并 MUST NOT 建立按完整代码内容永久增长的全局结果缓存。

#### Scenario: 页面包含多个同语言代码块

- **WHEN** 多个消息渲染相同受支持语言的 fenced code
- **THEN** 它们复用同一个 highlighter 和已加载 grammar
- **AND** 不为每个代码块重新初始化 engine

#### Scenario: 消息卸载

- **WHEN** 一个已高亮消息从 UI 卸载
- **THEN** 其组件级代码结果可以被回收
- **AND** 全局状态不保留以完整代码字符串为 key 的永久缓存条目

### Requirement: 依赖与 bundle 变更必须经过验证

实现 MUST 审计 Shiki 相关依赖和旧高亮依赖的真实引用，并 MUST 通过 typecheck、目标 lint、相关交互测试和生产构建验证客户端方案。

#### Scenario: 旧高亮依赖没有引用

- **WHEN** 全仓审计确认旧 `react-syntax-highlighter` 相关依赖没有调用点
- **THEN** 实现移除对应无用依赖并更新 lockfile

#### Scenario: 旧高亮依赖仍有调用点

- **WHEN** 全仓审计发现其它功能仍依赖旧 highlighter
- **THEN** 实现保留该依赖
- **AND** 在变更记录中说明调用点和后续清理范围

#### Scenario: 完成生产构建

- **WHEN** 语法高亮实现准备交付
- **THEN** 生产构建成功
- **AND** 变更记录包含客户端 bundle 前后对比及受控语言/theme 列表
