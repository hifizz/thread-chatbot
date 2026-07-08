# Tasks: 代码工作台

## 1. v1 组件级 Demo 工作台（已完成）

- [x] 1.1 安装 @codesandbox/sandpack-react（React 19 兼容）
- [x] 1.2 constants/workbench.ts：工具名、预装依赖、限制、系统提示词
- [x] 1.3 lib/workbench：types / files（路径归一、@/ 别名改写、cn 注入、依赖合并）/ store（zustand）
- [x] 1.4 route.ts：createDemo 工具（zod schema）+ 非研究模式注入工作台系统提示 + maxOutputTokens 32768
- [x] 1.5 create-demo-tool.tsx：artifact 卡片，流式 upsert，自动开面板（历史恢复不打扰）
- [x] 1.6 workbench-panel.tsx：预览/代码切换、流式只挂编辑器、完成后 key 重挂干净打包
- [x] 1.7 布局集成（base.tsx 分栏 + Demo 建议组）+ .env.local 切 MiniMax-M3
- [x] 1.8 端到端 QA：Dialog Demo 生成 → 面板自动打开 → 预览可交互（弹窗动画）→ 代码视图 → 刷新后恢复
- [x] 1.9 修复 Tailwind @layer 与 Sandpack 高度冲突（important 覆盖）、隐藏失灵的 sp-loading 遮罩

## 2. v2 真·Next.js 全栈沙箱

### 2.a Apple container 实验版（2026-07-07 已跑通）

- [x] 2.a.1 sandbox-template/：Next 16 + Tailwind v4 + framer-motion + lucide 模板，node_modules 烘焙进镜像（npmmirror）
- [x] 2.a.2 lib/sandbox/manager.ts：封装 container CLI（ensure/applyFiles/status/logs/destroy/build），tar 管道写文件（VM 内原生 inotify → HMR 生效）
- [x] 2.a.3 /api/sandbox 路由（GET 环境探测 + ensure/apply/status/destroy/build 五动作）
- [x] 2.a.4 面板容器运行时切换（ContainerIcon 按钮）+ ContainerPreview 状态机（检测→构建→启动→就绪→iframe 直连容器 IP）
- [x] 2.a.5 端到端验证：VM 启动+文件同步+next dev 就绪约 12s；HMR 3s 内生效；Dialog Demo 在真 next dev 里完整交互
- [ ] 2.a.6 遗留：磁盘清理后重跑 `container build -t thread-chat-sandbox:base -f sandbox-template/Dockerfile sandbox-template/` 把 allowedDevOrigins 修复烘进镜像（模板文件已修，现有沙箱是热修的）
- [ ] 2.a.7 遗留：沙箱空闲回收（当前需手动销毁）；stop/start 后 IP 会变化，面板需重走发现流程（切换运行时即可）

### 2.b 通用化（后续）

- [ ] 2.b.1 定义 SandboxRuntime 接口（mount/applyFiles/previewUrl/logs/dispose），Sandpack/container 双实现归一
- [ ] 2.b.2 shadcn 组件库预装进模板（当前模板只有 cn()，shadcn 风格代码仍需自包含输出）
- [ ] 2.b.3 writeFile/editFile 增量工具替代整包 createDemo（保留兼容），支持"改这个按钮颜色"级别的小修改
- [ ] 2.b.4 系统提示升级：容器模式下 App Router 约定、Server Actions/API 路由可用
- [ ] 2.b.5 备选运行时：本地进程（无 VM 开销）/ WebContainers（可部署公网）按需补充

## 3. v3 Agent 化写码循环

- [ ] 3.1 预览运行时错误/编译错误自动回喂模型修复（error → fix 循环，上限 N 轮）
- [ ] 3.2 diff/patch 编辑协议，降低重写成本
- [ ] 3.3 bolt 式文本流协议（<artifact> 标签解析）改善打字机流式体验
- [ ] 3.4 终端/构建日志面板

## 4. v4 工程能力

- [ ] 4.1 文件树 + 用户可编辑（编辑回写沙箱，与会话上下文同步）
- [ ] 4.2 导出 zip / 推送 GitHub 仓库
- [ ] 4.3 模板库与示例画廊

## 5. v5 发布与分享

- [ ] 5.1 一键部署（Vercel / Cloudflare）
- [ ] 5.2 只读分享链接
- [ ] 5.3 元素选中改写（select-to-edit）
