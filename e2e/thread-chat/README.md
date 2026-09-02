# ThreadChat tests

ThreadChat 的权威测试只覆盖规范化 Project/Thread/Message/Artifact 模型、v1 API、
AI SDK UI Message 流协议、独立 Stream Session，以及不改变既有列/画布/Composer 的
展示层回归。旧整树 JSON、generation sidecar、active-leaf 切换和旧计费结算测试已随
Gate 4 cutover 删除，不能再作为正确行为的依据。

主要命令：

```bash
pnpm test:thread-chat:gate1-db
pnpm test:thread-chat:gate2-session
pnpm test:thread-chat:gate2-pipeline
pnpm test:thread-chat:gate2-db
pnpm test:thread-chat:gate2-api
pnpm test:thread-chat:gate2-api-db
pnpm test:thread-chat:gate3-client
pnpm test:thread-chat:gate4-cutover
```

带 `-db` 的脚本使用 `THREAD_CHAT_TEST_DATABASE_URL` 指向的专用 PostgreSQL；脚本用
随机用户隔离，并在 `finally` 清理。浏览器验收必须按项目 AGENTS.md 使用
`ego-browser nodejs`，正式入口为 `/thread-chat/{projectId}`。
