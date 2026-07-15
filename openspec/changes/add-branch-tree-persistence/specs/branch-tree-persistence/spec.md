# branch-tree-persistence 分支对话树持久化

## ADDED Requirements

### Requirement: 分支树整树存储

系统 SHALL 以「一棵树一行」的形式将完整 `ThreadTreeState`（含全部 thread、消息、划选锚点 TextAnchor、Artifact 登记、footnoteCounter/seq 等计数器）作为 JSON 持久化到 Postgres 表 `branch_trees`，并与主聊天页的 `threads`/`messages` 表保持完全独立（不建立外键、不复用行）。

#### Scenario: 首次保存创建新行

- **WHEN** 客户端以一个此前不存在的 treeId 发起保存
- **THEN** 系统 SHALL 插入一行（id=treeId、state=整树 JSON、title=派生标题），createdAt/updatedAt 为当前时间

#### Scenario: 再次保存更新同一行

- **WHEN** 客户端以已存在的 treeId 再次保存
- **THEN** 系统 SHALL 原地更新该行的 state/title/updatedAt（upsert），不产生新行

### Requirement: 读写 API 契约

系统 SHALL 提供 `GET /api/branch-trees/{treeId}` 与 `PUT /api/branch-trees/{treeId}` 两个路由。GET 命中返回 `{ state: ThreadTreeState }`；**未命中 SHALL 返回 HTTP 200 与 `{ state: null }`**（首访者的正常路径，不是错误）。PUT 接受 `{ state, title? }` 并 upsert，成功返回 `{ ok: true }`；state 缺失或非对象时 SHALL 返回 400。

#### Scenario: 首次访问（无历史）

- **WHEN** 客户端 GET 一个从未保存过的 treeId
- **THEN** 响应为 200 且 body 为 `{ state: null }`，客户端据此以空树启动

#### Scenario: PUT 非法载荷

- **WHEN** PUT body 缺少 state 字段或 state 不是对象
- **THEN** 响应为 400，且不写库

### Requirement: URL 即树身份

系统 SHALL 以 URL 路径段承载树身份：`/thread-chat/{treeId}` 打开指定的树；treeId SHALL 为 UUID 形状（路由与 API 对不合法形状分别返回 404/400）。裸路径 `/thread-chat` SHALL 重定向（history replace）到「最近一棵」（localStorage 记忆）或新生成的 UUID。页面 SHALL 提供「新对话」入口跳转到新 UUID。localStorage 仅作「最近一棵」记忆，SHALL 只在客户端（effect 中）读写。

#### Scenario: 首次打开裸路径

- **WHEN** 访问 `/thread-chat` 且 localStorage 无「最近一棵」记录
- **THEN** 客户端生成 UUID 并 replace 跳转到 `/thread-chat/{uuid}`，以空树启动；回退键不弹回跳板页

#### Scenario: 再次打开裸路径

- **WHEN** 访问 `/thread-chat` 且 localStorage 记有最近使用的 treeId
- **THEN** replace 跳转到 `/thread-chat/{该id}` 并恢复那棵树

#### Scenario: 直接访问树 URL（跨会话/无 localStorage）

- **WHEN** 在全新浏览器上下文（无任何 localStorage）直接打开一个已存在树的 `/thread-chat/{treeId}`
- **THEN** 该树完整恢复（URL 是权威身份，不依赖本地状态），且该 id 被记为「最近一棵」

#### Scenario: 新对话

- **WHEN** 用户在**已有消息**的树上点击「新对话」
- **THEN** 跳转到新 UUID 的 URL，以空树启动；原树不受影响，可经原 URL 随时回来

#### Scenario: 空树上点「新对话」（实施修订，用户定稿）

- **WHEN** 当前树尚无任何消息时点击「新对话」
- **THEN** 无操作：URL 不变、不生成新 id，仅轻提示「当前就是全新对话」——空树本就不落库，反复点击不应使 URL 徒变

### Requirement: 先加载后挂载

页面 SHALL 先完成远端加载（GET）再创建会话 store 并渲染交互界面；加载期间展示轻量占位。加载得到的 state SHALL 经过「非终态收敛」（见下一条 Requirement）后才作为 store 种子。加载失败（网络/服务端错误）时 SHALL 以空树降级启动并在控制台留警告，不得阻塞页面。

#### Scenario: 正常恢复

- **WHEN** GET 返回已存的 state
- **THEN** 页面以该 state 为种子创建 store，主线消息、分支列、划选锚点高亮/脚注全部恢复

#### Scenario: DB 不可用降级

- **WHEN** GET 请求失败（如本地 Postgres 未启动）
- **THEN** 页面以空树启动、控制台警告，聊天功能可用（仅不持久化）

### Requirement: 加载期非终态消息收敛（sanitize）

从持久化快照恢复时，系统 SHALL 把 assistant 消息中 status 为 `pending`/`streaming` 的残留（防抖可能在流式中途存过盘）收敛为终态：有正文的置为 `done`；无正文的空占位直接删除。恢复后的页面 SHALL 不存在任何转圈/流式态气泡。

#### Scenario: 流式中途存盘后重载

- **WHEN** 上次存盘发生在某条 assistant 消息 streaming 到一半时（已有部分正文），随后页面重载
- **THEN** 该消息以已有正文显示、状态为 done，不显示打字指示或光标

#### Scenario: pending 空占位重载

- **WHEN** 快照中存在 status=pending 且正文为空的 assistant 消息
- **THEN** 恢复后该占位消息不出现（已被删除），会话可正常继续发送

### Requirement: 每棵树的工作台状态记忆

系统 SHALL 在 localStorage 以按 treeId 分键的方式记住每棵树的工作台状态（打开的分支列及折叠态、列宽、列数覆盖、放置策略、列/画布视图模式），并在重新打开该树时恢复。恢复前 SHALL 校验所引用的 threadId 仍存在于加载回来的树中，失配项过滤、全空回退默认布局。工作台状态 SHALL 不进入 DB 的 `state`（对话数据与设备本地 UI 态分离）。

#### Scenario: 重开同一棵树恢复布局

- **WHEN** 用户在树 A 开了三列并调过列宽，离开后重新打开树 A 的 URL
- **THEN** 三列与列宽按原样恢复

#### Scenario: 不同树互不串扰

- **WHEN** 树 A 开着三列、树 B 只用画布视图，用户在两棵树之间切换
- **THEN** 每棵树各自恢复自己的布局，互不覆盖

#### Scenario: 布局引用了已不存在的分支

- **WHEN** 工作台记忆里引用的某个 threadId 在加载回来的树数据中不存在（如数据被外部修改）
- **THEN** 该列被过滤掉，其余列正常恢复；全部失配时回退为只开主线

### Requirement: 变更防抖存盘与卸载 flush

客户端 SHALL 订阅 store 版本变化并以约 1.5 秒防抖发起整树 PUT——流式期间的高频版本跳变被合并为流式结束后的一次写入。组件卸载时若存在未落盘的待写 SHALL 立即 flush 一次。首屏（版本未变过）SHALL 不发起写入。

#### Scenario: 流式回复期间

- **WHEN** assistant 正在流式输出（store 版本高频递增）
- **THEN** 防抖窗口内不发起 PUT；流式结束且静默 1.5s 后发起一次整树 PUT

#### Scenario: 关闭/离开页面

- **WHEN** 存在未落盘的变更且组件卸载
- **THEN** 客户端立即发起一次保存（尽力而为），不阻塞卸载
