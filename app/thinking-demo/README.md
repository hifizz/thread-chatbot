# AI 输出过程演示

启动 `pnpm dev`，访问 `/thinking-demo`。本 worktree 的端口由 `.env.local` 的 `PORT` 决定。

这是本地交互演示，不调用模型、搜索服务或数据库。开发环境的 localhost / 127.0.0.1 可直接访问；其他环境仍沿用项目登录限制。

## 演示内容

- 普通推理、联网搜索、深度研究三个脚本。
- 摘要逐步显示，搜索和读取卡片嵌在对应步骤下。
- 深度研究包含初次检索、读取、复核、补充检索、综合结果。
- 暂停、继续、重播、倍速、停止、工具超时与原步骤重试。
- 正文逐步输出，开始输出时默认收起过程；用户手动展开或收起的选择优先。
- 来源详情、独立深浅色切换、移动端布局、减少动态效果支持。
- 自动跟随最新内容；向上滚动后暂停跟随，可点击回到最新进度。

脚本和播放参数集中在 `constants/thinking-demo.ts`。计时是演示播放时间，非生产任务耗时估计。

## 参考组件和样式

参考源码：

- https://www.beautifului.dev/r/thinking-state.json
- https://github.com/slev12397/beautiful-ui/blob/main/app/globals.css

原 ThinkingState 用固定定时序列模拟状态。这里保留轻量标题、文字微光、展开过程、竖向连线和步骤渐入的视觉方向，改为同一播放状态驱动摘要、工具与回答。

`foundation.css` 从上游通用基础样式提取浅色/深色 token 和 Tailwind 映射；使用 `td` 前缀及 `.thinking-demo` 作用域。动画与 reduced-motion 放在页面样式中。阴影使用本地回退值，未增加 shadow-plugin 依赖；未覆盖宿主的 `app/globals.css`。

## 正式聊天接入

正式聊天已使用服务端真实 reasoning、工具调用及结果，按 parts 顺序展示同级区块。每段思考只有一个标题，正文支持限高滚动阴影；研究子问题用于标题匹配，不额外调用模型。

Demo 保留独立的脚本播放器，用于比较交互效果，其计时器和暂停行为不参与正式聊天。正式实现、状态边界和验证情况见 [接入说明](../../docs/chat/thinking-state-integration.md)。
