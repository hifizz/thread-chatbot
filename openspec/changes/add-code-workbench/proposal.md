# Change: 新增代码工作台（AI 实时生成 React Demo）

## Why

目标是把 thread-chat 演进为 bolt.new / lovable 式的「对话即写码」产品：用户说"帮我写一个基于 Tailwind、framer-motion 的 Dialog 组件"，右侧即打开在线预览器展示可交互的组件 Demo，并可切换到代码视图。此前仓库只有纯聊天与静态工具卡片，没有任何代码运行/预览能力。

## What Changes

- 新增 `createDemo` 后端工具：模型通过一次工具调用输出多文件 React + TypeScript Demo（title / files / dependencies），代码本体走流式 tool args，服务端 execute 仅回轻量确认。
- 新增右侧工作台面板（`components/workbench/workbench-panel.tsx`）：Sandpack（react-ts 模板）浏览器沙箱运行 Demo，预览 / 代码双视图，流式期间代码逐字流入编辑器、完成后自动切换到实时预览。
- 预览沙箱内置 Tailwind v4 浏览器运行时（`@tailwindcss/browser`）与 framer-motion、lucide-react、clsx、tailwind-merge、class-variance-authority 预装依赖；内置 `cn()` 工具文件；`@/` 别名 import 自动改写为相对路径，shadcn 风格代码开箱可用。
- 消息内新增 artifact 卡片（`create-demo-tool.tsx`）：展示生成状态，点击可随时重新打开某个 Demo；Demo 随 UIMessage JSONB 持久化，刷新后可恢复。
- 布局：`Base` 中 Thread 右侧挂载可关闭的分栏面板（桌面 58% 宽，移动端全屏覆盖）。
- 默认模型切换为 `MiniMax-M3`（.env.local），chat 请求统一放宽 `maxOutputTokens` 至 32768 以容纳多文件代码输出。

## Impact

- Affected specs: `code-workbench`（新增能力）
- Affected code:
  - `app/api/chat/route.ts`（createDemo 工具 + 工作台系统提示 + maxOutputTokens）
  - `constants/workbench.ts`、`lib/workbench/{types,files,store}.ts`（新增）
  - `components/workbench/workbench-panel.tsx`、`components/assistant-ui/create-demo-tool.tsx`（新增）
  - `components/assistant-ui/tools.tsx`、`components/examples/base.tsx`（注册与布局）
  - 依赖：`@codesandbox/sandpack-react@^2.20.0`
- 已知限制（见 design.md）：v1 为纯前端沙箱（无 Next.js 服务端能力）；Sandpack 依赖 codesandbox.io 远程打包器（其 Cloudflare 挑战会导致父层加载遮罩握手丢失，已通过隐藏冗余遮罩规避）；MiniMax 的 tool args 大块到达时打字机效果不明显。
