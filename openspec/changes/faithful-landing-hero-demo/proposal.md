## Why

首页核心演示与 ThreadChat 真实工作台的视觉和交互差距明显，被评价为“假模假式”，影响信任。用户已确认路线：在现有仿制结构上做高保真对齐，补齐核心交互链路，保留现有剧本与播放。

## What Changes

- 对齐真实工作台的 UI 元素：顶栏、列头（含面包屑/深度徽章/子分支/切换/收起）、讨论焦点横幅、继承的上文、用户/助手消息气泡、锚点下划线与脚注上标、消息工具条、输入框（含模型选择/附件/语音占位/发送与停止态）、Artifact 卡与生成占位、折叠细条、列间分割线、滚到底按钮。
- 补齐核心交互本地可用：助手正文划选→工具条（在当前对话问/此处提问）→气泡提问→右侧开分支；分支内提问与发送；列切换/收起/展开/拖宽；@ 引用 Artifact 胶囊的插入/移除/发送；复制/重新生成/反馈/重试等消息行为。
- 全部交互走本地演示闭环：沿用现有六套剧本预设回答，不调用模型，不创建真实会话，不写库。
- 保留章节播放、重播与虚拟游标；游标目标位跟随对齐后的真实 DOM 更新。
- 样式继续隔离在 `.threadchat-landing` 内，不使用真实工作台的 `.tc` 类，不新增依赖、数据库或网络服务。

## Capabilities

### New Capabilities

- `landing-hero-fidelity`: 首页核心演示与 ThreadChat 工作台的高保真 UI 对齐与本地可交互行为。

### Modified Capabilities

- 无。

## Impact

影响 `components/landing/hero-demo/*`、`components/landing/landing.css`，可能小幅调整 `constants/landing-demo.ts` 的演示文案结构；不改 `app/thread-chat/**`、数据库、依赖与路由。
