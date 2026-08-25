# Thread Chat UI parity baseline

本目录是在客户端数据接缝修改前，通过 Ego Browser 任务空间 `11`
（`thread-chat-ui-parity`）记录的旧 UI 参考。后续阶段 8.8 与 9.7 必须以这里的截图和
交互清单为准；除已批准的 Project loading 外，不得把实现差异解释为新的设计。

## 采集环境

- 日期：2026-08-25
- viewport：`1674 × 963` CSS px
- 专用本地账号：`thread-chat-e2e-20260825@example.com`
- 数据库：allowlist 保护的独立 `thread-chat-test` PostgreSQL
- Fixture：一条 Main、两层嵌套 Fork、一个 Markdown Artifact；不调用真实模型
- 旧路由：`/thread-chat/{treeId}`
- 旧 UI 的历史 Message 省略 `status`，沿用“缺省即完成”的既有语义；没有伪造
  generation sidecar，也没有建立新旧双写

## 参考截图

| 文件 | 状态与必须保持的输出 |
| --- | --- |
| `empty-project.png` | 空白 Project：单个 Main 列、固定 Header、底部居中 Composer |
| `single-column.png` | Main 消息、Artifact 卡片、Header 计数，正文宽度与留白 |
| `header-child-selector.png` | Header Child 选择器；列出直接和嵌套后代，显示脚注号 |
| `two-columns.png` | Main + 第一层 Fork；相邻列、breadcrumb、引用与继承上下文 |
| `three-columns-nested-fork.png` | Main + Fork + 嵌套 Fork；两个相邻分割线 |
| `artifact-drawer.png` | Markdown Drawer 打开态；右半屏预览、来源与定位操作 |
| `divider-dragged.png` | 第一条分割线向右拖动 110px 后的局部列宽变化 |
| `collapsed-column.png` | 收起末端 Fork 后保留 Main + 上游 Fork，并重新均分空间 |
| `thread-switcher.png` | 当前物理 Slot 的 Thread 切换器、搜索框和“本列”标记 |
| `switched-slot.png` | 同一第二 Slot 从第一层 Fork 切换到嵌套 Fork |
| `breadcrumb-back.png` | 点击上游 breadcrumb 后，同一 Slot 回到第一层 Fork |
| `fork-composer.png` | 划选 assistant 原文后的 Fork Composer 与放置目标 |

## 固定交互清单

### Header 与基本布局

1. 顶栏顺序保持为：新对话、对话列表、产品名、使用提示、列/画布、列数、列满放置
   策略、会话树、Markdown、账号。
2. Main Header 显示“锚定”、标题、副标题和 Child 数量；Branch Header 显示层级、标题、
   Child、`⇄ 切换`、`收起`，其上方保留 breadcrumb。
3. Composer 固定在每列底部；Main placeholder 为“继续在主线提问…”，Branch 为
   “在这个分支里追问…”。
4. 1674px viewport 下三栏初始宽度约为 `558.33 / 558.34 / 557.34px`。

### Fork 与多栏

1. 划选 assistant 文本后，原文保持浏览器选择高亮，并打开“在新分支中讨论这段”
   Composer；问题可留空，放置目标显示现有物理 Slot 与右侧新增 `+`。
2. Main Header 的 Child 选择器同时显示第一层和嵌套后代；点击第一层 Fork 在来源列紧邻
   右侧打开，不改变 Main Slot。
3. 从第一层 Branch 的 Child 选择器打开嵌套 Fork 后形成三栏；嵌套列的 breadcrumb 为
   `Main › 第一层 › 当前 Thread`。
4. 点击 Branch 的“收起”会移除该物理 Slot，并让剩余列重新分配可用宽度。

### 切换与 breadcrumb

1. `⇄ 切换`打开当前 Slot 的 Thread 选择器；选择器列出 Main 和全部 Branch，当前内容显示
   “本列”，点击目标只替换该 Slot。
2. 第二 Slot 从第一层切到嵌套 Fork 后仍保持两栏，各约半宽；不会额外打开第三栏。
3. 点击嵌套 Fork breadcrumb 中的第一层标题，会在同一 Slot 回退到第一层并短暂使用
   `flash` 状态提示定位。

### 分割线

1. 分割线使用 `role="separator"`，可由鼠标、键盘操作，且 aria-label 明确相邻 Thread。
2. 第一条分割线从 `x≈558` 拖到 `x≈668` 后，列宽变为
   `668.33 / 448.34 / 557.34px`：只改变相邻两列，第三列不变。
3. 双击该分割线恢复三栏均分。

### Artifact Drawer

1. Header 的 Markdown 按钮显示 Artifact 数量；消息中的 Artifact 卡片可打开同一 Drawer。
2. 在本 viewport 下 Drawer 从 `x=837` 开始，宽 `837px`，覆盖右半屏；左侧工作区保持原布局
   状态而不是销毁。
3. Drawer 显示 Artifact 标签、Markdown 正文、来源 Thread 和“定位来源会话”；关闭后恢复
   原多栏视图。

## Parity 验收规则

- 后续截图使用相同 viewport、相同 Fixture 语义和相同交互顺序。
- 对比 Header 控件顺序、列数与宽度、稳定 Slot、breadcrumb、引用卡、Composer、Drawer
  尺寸以及拖拽前后数值。
- 文案由 Project/Thread 新实体提供时可以改变数据内容，但 CSS 类、空间关系和交互输出必须
  保持；任何必须造成用户可见差异的实现先停止并向用户确认。
