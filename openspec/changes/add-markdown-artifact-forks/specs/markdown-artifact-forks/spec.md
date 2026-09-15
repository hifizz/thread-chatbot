## ADDED Requirements

### Requirement: Markdown 阅读区支持选区提问

系统 SHALL 在已完成 Markdown Artifact 的阅读区提供划选后“此处提问”，复用现有桌面提问浮层、手机 Drawer 和列放置规则。第一版 SHALL 仅为 Artifact 选区开放此处提问动作，不把“本对话继续”隐式绑定到当前焦点 Thread；消息正文原有动作不变。

#### Scenario: 从消息卡片打开产物

- **WHEN** 用户点击 Markdown 卡片，划选文档正文并点击此处提问
- **THEN** 提问界面展示所选原文，并允许输入问题后提交或留空开分支

#### Scenario: 从项目面板打开产物

- **WHEN** 用户从 Project Artifact 列表打开同一产物并划选
- **THEN** 使用同一阅读组件和分支行为，不能因入口不同创建另一种来源关系

#### Scenario: 不支持的产物或只读入口

- **WHEN** 用户浏览 Code、Note、上传附件、未完成产物或公开只读分享页
- **THEN** 不提供本能力的新建分支操作，既有阅读行为保留

### Requirement: 唯一选区采集器识别内容来源

系统 SHALL 由同一工作区选区采集器处理消息正文与 Artifact，以显式来源身份和内容根解析选区。SelectionSurface SHALL 只登记来源，MUST NOT 按每份文档新增 document 级监听器。选区必须完全位于一个内容根，不持久化 DOM 或屏幕坐标。

#### Scenario: 多个阅读区域同时存在

- **WHEN** 页面同时展示消息正文和 Artifact，其他消息持续流式更新
- **THEN** 仅产生一个有效选区状态和一个操作界面，手机稳定计时不因无关流式更新反复重置

#### Scenario: 选区跨越边界

- **WHEN** 选区跨消息、跨 Artifact、包含工具按钮或超出同一内容根
- **THEN** 不创建有效分支选区，不沿用上一次选区伪装本次操作

### Requirement: 分支固定关联产物的来源消息

系统 SHALL 使用 Artifact 的权威 `threadId` 与 `sourceMessageId` 作为新分支父节点和历史截止点。新建来源 SHALL 为用户所属 Project 内的 completed assistant Message，处于父 Thread 的当前有效时间线；归档 Project 或归档来源 Thread 不接受新建操作。

#### Scenario: 焦点位于兄弟分支

- **WHEN** 用户正在 Thread A 浏览 Thread B 的 Artifact 并创建分支
- **THEN** 新分支挂在 B 下，分支树、面包屑和列放置使用 B 的来源身份

#### Scenario: 来源已被替代

- **WHEN** 提交前来源 Message 已 superseded
- **THEN** 拒绝新建并说明来源已变化，不自动绑定替代 Message 或当前焦点 Thread

### Requirement: Thread 持久化区分正文与 Artifact 锚点

系统 SHALL 在 Thread 新增 nullable `forkArtifactId`，复用既有 `forkMessageId`、`forkAnchor`、`anchorText`、`forkContext`。根节点和正文 Fork 的该字段 SHALL 为 null；Artifact Fork 的该字段 SHALL 指向真实 Artifact，且 Project、来源 Message、父 Thread 关系一致。来源 SHALL 随 DTO、store、视图映射及现有导出/分享序列化保留。

#### Scenario: 刷新产物分支

- **WHEN** 用户刷新已创建 Artifact Fork 的项目
- **THEN** 恢复父子关系、产物 ID、选区及来源导航，不依赖原页面的 Selection 或临时状态

#### Scenario: 读取历史正文分支

- **WHEN** 旧 Thread 没有 forkArtifactId 字段或值为 null
- **THEN** 按现有消息正文分支读取，不猜测 Artifact 来源

#### Scenario: 防止错误高亮正文

- **WHEN** 来源消息正文恰好也包含 Artifact 被选中的同一句话
- **THEN** Artifact Fork 的标记只关联该 Artifact，不把文档内位置应用到消息正文

### Requirement: Fork 命令兼容且由服务端验证来源

系统 SHALL 扩展现有 Fork 接口，以 message/artifact 判别 target 接收选区，保留既有首问有序 Parts 和幂等命令协议。旧 anchorText/anchor 请求 SHALL 规范化为 message target；新旧来源字段同时出现的歧义请求 SHALL 拒绝。服务端 SHALL 在事务内读取权威来源，拒绝客户端 Artifact 全文、标题、来源状态等额外权威字段。

#### Scenario: 旧客户端创建正文分支

- **WHEN** 客户端提交现有合法 Fork 请求且未提供 target
- **THEN** 正文分支创建与之前一致，forkArtifactId 为 null

#### Scenario: 跨项目或来源身份伪造

- **WHEN** Artifact 属于其他用户/Project，或请求父 Thread、sourceMessageId 与实际来源不一致
- **THEN** 在写入及付费模型调用前拒绝，不泄漏无权访问的产物内容

#### Scenario: 幂等重试

- **WHEN** 首次提交成功但客户端未收到响应，随后以同 commandId 和同 payload 重试
- **THEN** 返回同一 Thread 和生成结果，不重复分配脚注、消息或生成尝试

#### Scenario: 幂等 ID 被用于不同请求

- **WHEN** 同 commandId 被提交不同问题或选区
- **THEN** 返回命令冲突，不能复用为第二个新操作

### Requirement: 选区在规范化可见文字中准确验证

Artifact 选区 SHALL 使用与前端一致的规范化可见文本规则验证 exact、prefix、suffix 与可选 UTF-16 position。系统 MUST NOT 用 Markdown 源码下标或 raw includes 替代渲染文本校验，MUST NOT 用 fuzzy 匹配授权新 Fork。无唯一匹配、超限或不支持的渲染区域 SHALL 明确拒绝；接受后原样保存 exact，不静默改写用户选区。

#### Scenario: 带格式文字

- **WHEN** 用户划选含粗体、链接可见文字、列表、表格、代码或 emoji 的合法普通文本
- **THEN** 前后端在同一文本规则下定位，保存的 exact 与用户可见选区一致，界面按钮不计入偏移

#### Scenario: 文档内重复文字

- **WHEN** 相同 exact 多次出现
- **THEN** 使用位置及前后文唯一定位，仍有歧义则拒绝，不默认取第一处

#### Scenario: 非规范化区域

- **WHEN** 选区包含 Mermaid 图形或公式渲染的辅助 DOM 等本期不支持区域
- **THEN** 提示选择普通文字，不发送一个看似成功但无法验证的选区

### Requirement: 首问可选且 Quote 可删除

带非空问题的提交 SHALL 原子保存 Thread、用户实际有序 Parts 与 assistant 占位，并在提交后启动既有生成。问题为空 SHALL 只创建空分支，不调用模型。预填 Quote SHALL 使用现有 Artifact Quote Schema，用户可删除。保留的首问 Quote SHALL 精确匹配 Thread 的 Artifact、Message、Anchor 和 exact；此规则不放宽其他跨 Thread Quote。

#### Scenario: 带问题立即讨论

- **WHEN** 用户保留引用并提交非空问题
- **THEN** 首条用户消息包含对应 Artifact data-quote 和问题，后续生成使用既有生命周期

#### Scenario: 先创建空分支再发送

- **WHEN** 用户留空开分支，之后在 Composer 提交问题并保留引用
- **THEN** 空分支已保存来源；后续首问通过同一精确来源校验，不被当作任意跨 Thread 引用

#### Scenario: 删除首问引用

- **WHEN** 用户发送前或通过现有消息编辑流程删除 Quote
- **THEN** 实际用户 Parts 不含被删 Quote，Thread 来源仍存在，UI 不伪造消息引用，模型不从 Thread 锚点重新合成 Quote

#### Scenario: 偷换预填引用

- **WHEN** 首问引用被替换为其他 Artifact、来源 Message 或同一文档的另一段文字
- **THEN** 拒绝首问写入和生成，不扩大为任意跨 Thread Quote

### Requirement: 产物全文通过冻结历史稳定继承

系统 SHALL 维持 forkContext 的原序 Message ID；不得写入 Artifact ID 或重算历史。模型最终输入 SHALL 包含继承来源消息对应的固定 Artifact 标题和全文，支持 Artifact-only Message。选区及批注 SHALL 仅从实际 Quote Parts 编译，并位于继承历史之后；Thread 来源字段只用于关系与导航，不作为隐藏选区提示。

#### Scenario: 来源消息只有产物卡片

- **WHEN** 来源 Message 没有正文，只有已完成 Markdown Artifact
- **THEN** 最终模型输入仍包含权威文档全文与标题，不能只发送工具 ID 或卡片标题

#### Scenario: 空分支刷新后再提问

- **WHEN** 用户创建空分支、刷新并提交第一条问题
- **THEN** 通过已保存的冻结历史读取同一产物，不依赖临时 Composer 或第一次页面渲染

#### Scenario: 从分支继续创建后代

- **WHEN** 用户在 Artifact 分支内继续从消息正文开分支
- **THEN** 后代继承历史仍包含原产物，来源定位链不丢失，不重复注入祖先选区

#### Scenario: 删除 Quote 后的全文

- **WHEN** 用户移除首问 Quote 后重新生成
- **THEN** 正常继承的文档全文仍可用，但模型请求不额外包含从 Thread 锚点合成的选区文本

### Requirement: 全文去重与请求预算沿用统一路径

系统 SHALL 根据最终保留的完整且身份、内容匹配的产物正文判定去重；工具只有 ID/标题、不完整或被 SDK 剔除时不能视为全文已包含。展开 SHALL 保持确定性和共同历史前缀，不因子分支的选区或新增后文改写既有历史。系统 SHALL 使用统一预算，不静默截断或新增 Child 专属字符上限。

#### Scenario: 全文已包含后再次显式引用

- **WHEN** 继承历史已完整包含目标 Artifact，用户又以 @artifact 引用它
- **THEN** 保留引用位置与固定身份标记，但不再次展开全文

#### Scenario: 只有工具摘要

- **WHEN** 最终模型历史仅有 Artifact ID 或标题
- **THEN** 在对应来源消息的稳定位置补入权威全文，不能误判为已提供完整文档

#### Scenario: 两个兄弟分支选区不同

- **WHEN** 两个分支继承相同历史与实际模型配置，仅实际用户 Quote 不同
- **THEN** 文档相关的共同历史模型前缀一致，差异从各自用户 Parts 开始

#### Scenario: 请求超限

- **WHEN** 完整请求已知超过模型上下文预算
- **THEN** 调用模型前返回可读错误，不截断文档或回写历史；无法可靠计量时明确保留 unknown 并映射提供商超限错误

### Requirement: 移动端及失败过程保护问题草稿

系统 SHALL 复用手机选区稳定采集、原生选区清空后的快照和提问 Drawer，复用桌面浮层与临时高亮。聚焦输入后选区高亮仍可见，取消后释放临时高亮。失败 SHALL 保留问题和选区；成功后才清理已提交状态并打开新列，不因关闭上层提问界面误删阅读状态或草稿。

#### Scenario: 手机调整选区后输入

- **WHEN** 用户长按选择文档文字、调整手柄并进入提问 Drawer
- **THEN** 引用采用最终稳定选区，键盘聚焦后仍能看到引用，工具条不会重复弹出

#### Scenario: 提交失败或结果未返回

- **WHEN** 网络请求失败或结果不确定
- **THEN** 保留问题与来源快照，可用同命令重试；不展示一个无法恢复的成功空列

#### Scenario: 取消提问

- **WHEN** 用户按现有草稿规则取消提问
- **THEN** 清除临时高亮，已有分支标记和 Artifact 正文保持不变，手机层级关闭与焦点恢复正确

### Requirement: 来源导航准确返回 Artifact 原文

系统 SHALL 从 Thread 来源与实际存在的 Artifact Quote 提供可访问的来源操作：打开指定 Artifact，等待渲染就绪，再滚动和高亮指定选区。导航 MUST NOT 仅停在来源 Message 卡片，MUST NOT 在其他 Artifact 或消息正文匹配同一句话。现有分支标记 SHALL 按 Artifact ID 过滤，正文保持不变。

#### Scenario: 文档面板当前关闭

- **WHEN** 用户在新分支点击产物来源
- **THEN** 打开该文档，在内容根就绪后滚动到正确选区并短暂高亮

#### Scenario: 不同产物有相同句子

- **WHEN** A1 和 A2 都含同一句话，分支来自 A2
- **THEN** 导航及高亮仅发生在 A2，不根据全文搜索跳到 A1

#### Scenario: 定位失败

- **WHEN** 目标存在但渲染后无法准确匹配原选区
- **THEN** 展示文档及可用引用原文，提示未能准确定位，不猜测高亮、不无限等待

### Requirement: 历史产物来源保留且不追随新内容

系统 SHALL 保留已创建分支引用的固定 Artifact ID、内容和来源。来源消息后来 superseded 或来源 Thread 归档，不得自动改写既有 forkContext 或绑定同名新 Artifact。整体 Project 删除沿用既有权限；Project 存续时不得单独删除被引用目标而把 Artifact Fork 伪装为正文 Fork。

#### Scenario: 重新生成同名文档

- **WHEN** 原来源被替代并产生同名新 Artifact
- **THEN** 旧分支继续打开和使用旧文档，不能自动指向新产物

#### Scenario: 已有分支引用目标缺失

- **WHEN** 数据异常造成目标无法加载
- **THEN** 返回明确的来源不可用或上下文不完整提示，不静默切换来源

### Requirement: 分层组件与兼容发布

系统 SHALL 在现有模块内实现本能力：ArtifactDetail 负责阅读，SelectionSurface 声明来源，共享选区组件负责交互，工作区命令负责网络与列放置，应用层负责事务与上下文。实现 SHALL 同步覆盖 Schema、DTO、mapper 和视图来源；先完成 additive migration 验证及服务端兼容，再启用新客户端入口。

#### Scenario: 项目面板拆分后

- **WHEN** Artifact 阅读详情抽出为 ArtifactDetail
- **THEN** 项目目标、附件列表、复制、定位来源和原 Markdown 渲染继续工作，不保留第二套 Artifact Drawer 实现

#### Scenario: 回退新建入口

- **WHEN** 新功能需要暂时停用
- **THEN** 可以关闭新增创建入口，同时保留新字段和兼容读取，使已有 Artifact 分支仍可回放
