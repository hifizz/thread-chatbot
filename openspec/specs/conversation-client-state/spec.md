## Purpose

让浏览器按稳定实体 ID 消费 Conversation 快照、命令增量和 Generation checkpoint，同时把领域事实、派生索引、界面工作区与乐观状态分开。

## Requirements

### Requirement: 按稳定 ID 规范化客户端实体

客户端 SHALL 分别按 ID 保存 Conversation、Thread、ThreadFork、Turn、Message 与 Generation，并保存服务端 revision/checkpoint version。一个规范实体在同一加载作用域内 MUST 只有一份客户端对象事实；组件不得保存可独立修改的嵌套实体副本。

#### Scenario: 两列引用同一来源 Message

- **WHEN** 上游 Thread 和下游 Fork 投影都展示同一个来源 Message
- **THEN** 二者通过相同 Message ID 读取同一实体，且任何服务端更新只需合并一次

#### Scenario: Generation 更新输出 Message

- **WHEN** 新 checkpoint 更新某条输出 Message
- **THEN** Store 按 Message ID 和版本替换该实体，所有订阅该 Message 的视图看到同一结果

### Requirement: 原子归一化 ConversationSnapshot

客户端 SHALL 验证 `ConversationSnapshot` 的 schemaVersion、实体归属、引用和 revision 后，在一个 Store 提交中替换目标 Conversation 的规范实体集合。解析或不变量验证失败 MUST 保留现有可用状态并显示可恢复加载错误，不得部分安装快照。

#### Scenario: 首次加载有效快照

- **WHEN** 接口返回受支持 schemaVersion 的有效 ConversationSnapshot
- **THEN** 客户端原子安装实体、revision 和可重建索引，组件不会观察到半条 Fork 或缺失 Message 的中间状态

#### Scenario: 快照包含悬空 ThreadFork

- **WHEN** 下游 Thread 或来源 Message 无法在快照中解析
- **THEN** 客户端拒绝整个新快照并触发诊断/重试，而不是自行补造关系

### Requirement: 按版本合并规范实体增量

客户端 SHALL 只通过服务器命令响应、查询或 Generation checkpoint 合并规范实体 delta。每个 upsert/remove MUST 比较对应 revision 或 checkpoint version；较旧或重复 delta SHALL 幂等忽略，无法安全解释的版本间隙 SHALL 触发作用域重取。

#### Scenario: 命令响应晚于更新查询

- **WHEN** 一个旧命令响应在更新的实体查询之后到达
- **THEN** Store 保留较新 revision，不被旧 delta 覆盖

#### Scenario: 收到未知 delta schemaVersion

- **WHEN** 客户端收到不支持的 delta schemaVersion
- **THEN** 客户端不应用该 delta，标记目标 Conversation 需要重新加载

### Requirement: Fork 和路径索引必须可重建

Thread children、父来源、深度、Fork 数量、Turn 顺序、当前有效 Message 路径和画布边 SHALL 从规范实体派生或缓存为可丢弃索引。客户端不得通过直接修改这些索引来表达 Fork、发送或变体选择。

#### Scenario: 合并新 ThreadFork

- **WHEN** Store 合并服务端返回的新 Thread 与 ThreadFork
- **THEN** children、深度、脚注/Fork 数量和画布边从关系重新派生，不要求响应同时提交多个反向字段

#### Scenario: 清空派生缓存

- **WHEN** 派生索引缓存被清除
- **THEN** 客户端能从规范实体重建等价列和画布关系，不向服务端写入任何修复

### Requirement: 界面工作区独立于领域事实

visible Thread 顺序、折叠、当前选中 Thread、列宽/策略、画布 viewport、打开面板、临时草稿和本地提示 SHALL 保存在独立 UI Workspace slice。改变这些字段不得改变 Conversation revision、ThreadFork、Turn 当前变体或触发领域命令。

#### Scenario: 折叠分支列

- **WHEN** 用户折叠或关闭一列
- **THEN** 客户端只更新 UI Workspace，Thread 与 ThreadFork 仍在规范实体 Store 中

#### Scenario: 归档当前可见 Thread

- **WHEN** 归档命令成功并使选中 Thread 不再活跃
- **THEN** Store 合并服务端生命周期 delta，UI Workspace 选择一个有效可见 Thread，而不删除历史关系

### Requirement: 通过统一客户端网关执行命令

组件 SHALL 通过统一 Conversation client gateway 执行命令，由网关附加幂等键、预期 revision、取消策略并解析规范响应。组件不得直接调用旧整树 PUT、手动推进 revision 或分别提交 Thread/Fork/Message 关系。

#### Scenario: 组件请求 Fork

- **WHEN** selection UI 请求从 Message 创建 Thread
- **THEN** 网关发送一个 `forkThread` 请求，并只在服务端成功后把规范 delta 合并进 Store

#### Scenario: 组件卸载时命令已提交

- **WHEN** 发起命令的组件卸载但服务端可能已提交请求
- **THEN** 网关保留幂等身份并允许结果进入共享 Store，组件卸载不触发补偿性整树覆盖

### Requirement: 乐观状态不得成为规范关系

客户端 MAY 为交互即时性保存草稿、pending command 和临时展示 overlay，但这些状态 SHALL 与规范实体分离并可按命令 ID 回滚。服务端未确认前，客户端不得把临时 ThreadFork、Message 身份或 active variant 当作规范事实用于后续命令。

#### Scenario: 乐观发送后版本冲突

- **WHEN** composer 显示待发送 overlay，但服务端返回 `version_conflict`
- **THEN** 客户端移除或标记失败 overlay、保留用户草稿、更新 revision，并允许用户明确重试

#### Scenario: 幂等重试成功

- **WHEN** 网络失败后网关以相同幂等键重试并收到原成功结果
- **THEN** 客户端用规范 Message/Generation ID 替换 pending overlay，不产生重复可见 Turn

### Requirement: 统一协调 Generation 订阅与轮询

客户端 SHALL 按 Generation ID 维护引用计数的监控协调器，合并流式事件和查询结果，并只应用更高 checkpoint version。视图挂载 SHALL 订阅需要的 Generation，卸载 SHALL 释放订阅；无浏览器订阅不得停止服务端 Generation。

#### Scenario: 两个视图观察同一 Generation

- **WHEN** 列视图和状态面板同时订阅一个运行中 Generation
- **THEN** 客户端只维持一个网络监控实例，并把更新分发给两个订阅者

#### Scenario: 最后一个视图卸载

- **WHEN** 最后一个订阅者卸载
- **THEN** 客户端释放对应定时器/事件监听；服务端继续执行，后续重新挂载通过查询恢复最新 checkpoint

#### Scenario: 轮询和流事件乱序

- **WHEN** 旧轮询结果晚于新流式 checkpoint 到达
- **THEN** 协调器忽略旧版本，不回退 Message 内容或 Generation 状态

### Requirement: 组件使用按 ID 定位的选择器

列、画布、Message、composer、标题、Artifact、反馈和 Message actions SHALL 通过 ID-scoped selector 读取最小所需实体及派生结果。无关实体更新不得要求所有列重新渲染；selector 不得返回可由组件原地修改的规范对象。

#### Scenario: 一个分支流式更新

- **WHEN** 某条分支 Thread 的 Message 收到 checkpoint
- **THEN** 订阅该 Message/Thread 的视图更新，未引用它的独立列无需因全局树版本变化重新渲染

#### Scenario: Message action 使用稳定身份

- **WHEN** 用户复制、反馈、重新生成或 Fork 某条 Message
- **THEN** 操作使用规范 Message/Turn/Thread ID 和 client gateway，不从数组位置或局部树键推断身份

### Requirement: 保持当前可见产品行为

迁移后的客户端 SHALL 保持现有列/画布导航、嵌套 Fork、Markdown、Artifact、研究活动、流式进度、停止、恢复、标题和 Message actions 的用户可见能力。行为等价不要求保留旧 `ThreadTreeState`、魔法 `main` ID 或整树持久化实现。

#### Scenario: 刷新恢复 stopped partial

- **WHEN** 用户停止带正文、Artifact 或研究活动的 Generation 后刷新
- **THEN** 客户端从规范快照/checkpoint 恢复相同 `incomplete` 内容和 `stopped` 状态

#### Scenario: 打开嵌套 Fork

- **WHEN** 用户从 A 打开 B，再从 B 打开 C
- **THEN** 列和画布通过 ThreadFork 投影显示正确层级、来源锚点和上下文，不依赖可写 children 数组

### Requirement: 规范客户端路径不保存整树或启动协调合并

启用规范客户端路径时，系统 MUST 禁用 `persistNow`、save debounce、卸载 flush、整树 CAS、`activeLeafMessageId` 写入以及为修复浏览器 partial 而运行的启动 reconcile。刷新恢复 SHALL 只依赖规范快照、命令结果和服务端 Generation checkpoint。

#### Scenario: 流式 token 高频到达

- **WHEN** Generation 连续产生流式更新
- **THEN** 客户端更新展示和规范 checkpoint 版本，但不防抖 PUT 整个 Conversation

#### Scenario: 页面卸载

- **WHEN** 用户在 Generation 运行中关闭页面
- **THEN** 客户端不 flush 整树，服务端执行和 checkpoint 机制继续承担持久化责任

