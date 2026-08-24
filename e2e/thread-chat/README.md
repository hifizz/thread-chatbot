# Thread Chat 验收入口

Issue #34 cutover 后，`/thread-chat` 只使用 canonical Conversation 模型。旧
`ThreadTreeState`、整树 API、浏览器 persistence/reconcile 与 sidecar Generation
测试已随运行时代码一并删除，不能再作为发布证据。

## 自动验证

从仓库根目录运行：

```bash
pnpm test:conversation-domain
pnpm test:conversation-generation-unit
pnpm test:conversation-command-contract
pnpm test:conversation-client
pnpm test:conversation-authority
pnpm test:conversation-persistence
pnpm test:conversation-generation
pnpm test:conversation-command-api
pnpm test:conversation-http-api
```

数据库测试读取 `.env.local`，创建隔离的随机夹具并在结束时清理。HTTP 测试连接
本地 `localhost:4040`，使用邮箱测试账号和 `glm-5.3` 验证真实 Generation、恢复、
停止、反馈、所有者隔离与 exactly-once billing。

仍保留在本目录的 `.test.mjs` 是与 canonical 路径共享的纯函数、模型注册表、Markdown
渲染和研究工具测试，可统一运行：

```bash
node --import tsx --test e2e/thread-chat/*.test.mjs
```

## 浏览器 smoke

浏览器验收必须按仓库规则使用 `ego-browser nodejs` 访问
`http://localhost:4040/thread-chat`，不得恢复或使用已删除的 Playwright legacy 脚本。
至少验证裸路径 bootstrap、Conversation 列表、三列 A → B → C、列/画布切换、发送与
流式恢复、归档/恢复、标题、反馈、Markdown，以及刷新后仍从 canonical snapshot 恢复。
