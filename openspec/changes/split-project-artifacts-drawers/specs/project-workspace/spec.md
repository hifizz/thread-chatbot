# project-workspace Specification Delta

## MODIFIED Requirements

### Requirement: Unified Project Panel

系统 SHALL 在 ThreadChat Workspace 顶栏提供 Project 与 Artifacts 两个独立入口，分别打开两个基于 workspace-drawers 能力、可共存的抽屉：Project Drawer 承载 Overview（Target、Instructions）与 Files（列表、上传、状态、打开、移除）；Artifacts Drawer 承载全 Project Artifact 的列表、预览与定位来源。抽屉的打开、关闭和切换 MUST NOT 改变当前 Thread 路由、列布局、画布位置或生成状态。

#### Scenario: Open Project Drawer from columns view

- **WHEN** 用户在列视图点击 Project 入口
- **THEN** 打开 Project Drawer，显示当前 Project 的 Overview 与 Files 区域

#### Scenario: Open Project Drawer from canvas view

- **WHEN** 用户在画布视图点击 Project 入口
- **THEN** 打开功能等价的 Project Drawer，当前画布节点和视口状态保持不变

#### Scenario: Open Artifacts Drawer from the topbar

- **WHEN** 用户点击 Artifacts 入口
- **THEN** 以右侧形态打开 Artifacts Drawer，显示全 Project Artifact 列表

#### Scenario: Open an Artifact from a message card

- **WHEN** 用户点击现有消息中的 Artifact card
- **THEN** 系统打开独立 Artifacts Drawer 的 Artifact detail；Project Drawer 的打开状态不被改变

#### Scenario: Empty Project resources

- **WHEN** Project 尚无 Files 或 Artifacts
- **THEN** 对应抽屉区域显示明确空态和可执行的下一步，不隐藏 Contract 编辑能力

## ADDED Requirements

### Requirement: Artifacts 紧凑浏览与渐进披露

Artifacts Drawer SHALL 以纵向紧凑列表展示全部 Artifact：每行包含标题、kind 标记与单行截断的来源元信息，点击行进入抽屉内详情视图，详情视图可返回列表。Artifact 总数低于系统阈值时 MUST 隐藏搜索框；达到阈值时 MUST 显示搜索框，阈值判定基于总数而非过滤后数量。隐藏搜索框时 MUST 清空已有搜索词。搜索无结果 MUST 显示「无匹配」空态，与「还没有 Artifact」的空列表态区分。

#### Scenario: 少文件不显示搜索框

- **WHEN** Project 中 Artifact 总数低于阈值
- **THEN** 列表直接呈现全部条目，不渲染搜索框

#### Scenario: 多文件显示搜索框

- **WHEN** Project 中 Artifact 总数达到阈值
- **THEN** 列表上方显示搜索框，可按标题、类型或来源 Thread 过滤

#### Scenario: 搜索无结果

- **WHEN** 用户输入的搜索词没有匹配任何 Artifact
- **THEN** 显示「无匹配」空态，而非「还没有 Artifact」

#### Scenario: 详情返回列表保留上下文

- **WHEN** 用户从详情视图返回列表
- **THEN** 搜索词与列表滚动位置保持返回前状态

### Requirement: 位置感知的 Artifact 打开

系统 SHALL 在用户从消息内 Artifact 卡片打开 Artifact 时，根据点击位置决定 Artifacts Drawer 的侧向：点击位置在视口左半区时抽屉开右侧，在右半区时开左侧，使抽屉尽量不遮挡被点击的卡片。键盘激活等无指针坐标的打开 MUST 回退为右侧。抽屉已打开时再次点击卡片：MUST 选中对应 Artifact 并将抽屉提升至栈顶，MUST NOT 改变既有侧向。

#### Scenario: 点击左半区卡片

- **WHEN** 用户在视口左半区点击 Artifact 卡片
- **THEN** Artifacts Drawer 以右侧形态打开并展示对应 Artifact detail

#### Scenario: 点击右半区卡片

- **WHEN** 用户在视口右半区点击 Artifact 卡片
- **THEN** Artifacts Drawer 以左侧形态打开并展示对应 Artifact detail

#### Scenario: 键盘激活卡片

- **WHEN** 用户通过键盘激活 Artifact 卡片
- **THEN** Artifacts Drawer 以右侧形态打开

#### Scenario: 抽屉已开时点另一张卡片

- **WHEN** Artifacts Drawer 已打开，用户点击另一张 Artifact 卡片
- **THEN** 抽屉展示新选中 Artifact 并提升至栈顶，侧向保持不变

### Requirement: Artifacts 入口徽标语义

顶栏 Artifacts 入口的计数徽标 SHALL 始终表示当前 Project 的持久化 Artifact 总数（含 Markdown、Code、Note 各 kind，含来源消息为 stopped/failed 但内容可读的 Artifact），计数为零时 MUST 显示 `0`。Project 入口不显示计数徽标。

#### Scenario: 徽标计数

- **WHEN** 当前 Project 存在持久化 Artifact
- **THEN** Artifacts 入口显示与总数一致的徽标，新增 Artifact 后徽标即时更新

#### Scenario: 零计数显示徽标

- **WHEN** 当前 Project 没有任何持久化 Artifact
- **THEN** Artifacts 入口显示计数 `0`
