# Design: 代码工作台

## Context

用户目标：在 thread-chat 中实现 bolt.new / lovable 式的 AI 写码体验，最低要求支持
Next.js / Tailwind / framer-motion / lucide / shadcn 风格的组件 Demo，最终目标是能跑真正的
Next.js 全栈项目。约束：本地 side-project（跑在开发者机器上）、模型为 MiniMax-M3
（OpenAI 兼容端点，token 充足）、已有 assistant-ui + AI SDK v7 + Postgres 持久化的聊天底座。

## 运行时选型调研（2026-07）

| 方案 | 真 Next.js | 启动速度 | 依赖生态 | 接入成本 | 主要风险 |
|---|---|---|---|---|---|
| **Sandpack（react-ts，v1 采用）** | ❌ 纯前端 React | 秒级 | Sandpack CDN 解析 npm | 极低（现成 React 组件） | 依赖 codesandbox.io 远程打包器；国内网络下其 Cloudflare 挑战有握手毛刺 |
| Sandpack + Nodebox（nextjs 模板） | ⚠️ 旧版 Next、慢 | 10s+ | 受限 | 低 | Nodebox 维护停滞，Tailwind v4 构建链不可用 |
| **WebContainers（StackBlitz）** | ✅ 浏览器内真 Node | 首次 10~30s | 真 npm/pnpm | 中（COOP/COEP、进程编排、终端流） | 商用需授权；内存重；国内网络不确定性 |
| **本地进程沙箱（v2 推荐）** | ✅ 完整 fidelity | pnpm 缓存下秒级 | 完整 | 中（进程/端口生命周期管理） | 在宿主机执行 AI 代码（个人本地工具可接受）；不可部署到 serverless |
| 云沙箱（Vercel Sandbox / E2B） | ✅ | 秒级 | 完整 | 中高（计费、API） | 付费；本项目当前无部署需求 |

**v1 决策：Sandpack react-ts。** 理由：当天可跑通端到端链路（工具协议 → 流式 → 面板 → 预览），
覆盖用户举例的全部场景（组件/动效 Demo 均为客户端代码）；管线各层（工具 schema、store、
面板 UI、系统提示）与运行时解耦，后续换运行时时全部可复用。

**v2 决策：本地进程沙箱（lovable 的服务端模式）优先于 WebContainers。** 理由：本项目跑在
开发者本机，`next dev` 子进程给出 100% fidelity（App Router / Server Actions / API 路由 /
真 Tailwind v4 构建 / shadcn 全家桶），pnpm store 使安装秒级，HMR 天然联动 AI 增量写文件；
WebContainers 的授权、内存与国内网络风险留作部署公网版本时的备选。

## 架构（v1）

```
用户消息 ─→ /api/chat (streamText + createDemo tool)
                │  tool args 流式（title → files[] → dependencies）
                ▼
  create-demo-tool.tsx（消息内 artifact 卡片）
                │  流式 upsert（含刷新后的幂等恢复）
                ▼
     lib/workbench/store.ts（zustand：artifacts / activeId / view）
                │
                ▼
  workbench-panel.tsx ── lib/workbench/files.ts 规整
        │（路径归一、@/ 别名→相对路径、注入 cn()、合并依赖）
        ▼
  SandpackProvider(react-ts)
   ├─ 流式：autorun=false，仅编辑器，StreamSync 跟随正在生成的文件
   └─ 完成：key 重挂触发干净打包，自动切预览（Tailwind v4 浏览器运行时注入 iframe）
```

关键决策：

1. **代码走 tool args 而非 tool result**：execute 只回 `{ok, fileCount}`，避免大段代码在
   模型上下文里往返两遍。实测 MiniMax-M3 单次可靠输出 9KB+ 的合法 JSON 转义 TSX。
2. **artifact 以 toolCallId 为主键存 zustand**：消息组件只负责 upsert 与自动开关面板，
   面板订阅渲染。Demo 数据随 `messages.content`(JSONB) 免费持久化，刷新后由卡片重挂载恢复。
3. **流式/完成两阶段 Sandpack**：流式期间 `autorun:false` 只喂编辑器（避免半成品代码反复
   触发打包报错），完成后通过 `key` 重挂一次性干净构建。
4. **防御式文件规整**：模型输出不可控，`files.ts` 负责让预览"尽量能跑"而不是报错——
   路径归一化、`@/` 别名改写（Sandpack 不认 tsconfig paths）、缺 `/App.tsx` 时用首个组件
   re-export 兜底、忽略模型对 react/react-dom/next 的版本指定。

## 踩坑记录（QA 实测）

- **Tailwind v4 @layer vs Sandpack stitches**：Sandpack 注入的样式不在 `@layer` 里，
  会压过 Tailwind 分层工具类，高度覆盖必须加 `!` important，否则预览高度停在默认 160px。
- **codesandbox.io 的 Cloudflare 挑战**：`cdn-cgi/challenge-platform` 使 iframe 主文档
  请求长期 pending，父层 sandpack-client 可能收不到 `done` 握手 → 白色 `sp-loading`
  遮罩永不消失（iframe 内部实际已编译渲染成功）。规避：CSS 隐藏 `.sp-loading`
  （保留 `.sp-error-overlay` 错误提示），iframe 内部自带编译进度 UI。
- **MiniMax tool args 大块到达**：M3 的工具参数并非逐 token 均匀流出，打字机效果弱；
  换文本流协议（v3 的 bolt 式 `<artifact>` 标签解析）可改善。

## 附录：Apple container 沙箱实验（2026-07-07）

v2 的"真 Next.js"用 Apple 开源的 container（brew formula `container`，1.0.0，Apple silicon
每容器一个轻量 VM）实验落地，替代了原计划的裸本地进程——多一层 VM 隔离，AI 生成代码不再直接跑在宿主机。

实测数据（M 系列 16GB / macOS 26）：镜像构建 ~3min（npmmirror）；VM 启动 + 文件同步 +
next dev 就绪 ~12s；HMR 热更新 ~3s；每个沙箱 VM 常驻内存约 2GB（--memory 2g）。

实验踩坑（都已修复或记录）：
1. **`container cp` 不支持 docker 的 `dir/.` 内容语义**（会把目录整个塞成子目录）。
   改用 `tar -cf - . | container exec -i <name> tar -xf - -C <dest>` 管道，目录树原样保留。
2. **Next 16 dev 拦截跨源 dev 资源**：宿主浏览器经容器 IP 访问时客户端 chunk/HMR 被拒，
   页面只有 SSR 无水合（能看不能点）。模板 next.config 启动时枚举 VM 自身 IPv4 填入
   `allowedDevOrigins`。
3. **`container ls --format json` 结构**：`.id` / `.status.state` / `.status.networks[0].ipv4Address`
   （CIDR 形式）；stop/start 后 IP 会变化。
4. **与 Docker Desktop 的 vmnet 互扰**：Apple container 动态创建 vmnet 接口时恰逢 Docker
   backend 枚举网络（`GET /networks`）会死锁，Docker daemon 整个卡死（本仓库的 Postgres 在
   Docker 里，会连带 500）。当时磁盘仅剩 ~600MB 也可能是诱因。恢复顺序：
   `container system stop` → 重启 Docker Desktop → `docker start thread-chat-pg` →
   `container system start`。两者稳态共存正常，但要避免在 Docker 启动/枚举网络的同时批量
   创建/销毁沙箱 VM。
5. **磁盘敏感**：镜像 + builder VM + 沙箱可写层合计数 GB，磁盘 <2GB 时 `container run`
   直接失败（NSPOSIXErrorDomain 28）。buildkit builder 不用时可 `container stop/delete buildkit`
   回收 ~2GB。

## 多轮迭代路线图

- **v1（本变更）**：Sandpack 组件级 Demo，预览/代码双视图，流式生成，持久化恢复。
- **v2 真·Next.js 全栈沙箱**：`SandboxRuntime` 接口抽象（mount/applyFiles/url/logs/dispose）
  + 本地进程实现：模板工程（Next 16 + Tailwind v4 + shadcn + framer-motion 预装）按
  thread 克隆到 `.sandboxes/<threadId>`，`next dev` 子进程池 + 端口分配 + 空闲回收，
  iframe 指向 localhost 端口，HMR 即预览更新；文件写入改为 `writeFile`/`editFile` 工具增量化。
- **v3 Agent 化写码循环**：预览错误/终端输出回喂模型自动修复（bolt 的 error→fix 循环）、
  diff 编辑而非全量重写、多步计划（先脚手架后逐文件）、bolt 式文本流协议替代 JSON tool args。
- **v4 工程能力**：文件树 + 用户可编辑（编辑器回写沙箱与会话）、依赖管理 UI、导出 zip /
  推 GitHub、模板库（landing page / dashboard / 表单）。
- **v5 发布与分享**：一键部署（Vercel/Cloudflare）、分享只读预览链接、元素选中改写
  （lovable 的 select-to-edit）、多模型路由。
