# Composer 浏览器回归

使用运行中的本地开发服务和 `ego-browser nodejs`，不启动 Playwright。测试真实 React、Lexical、草稿和附件队列；附件 HTTP 使用测试替身，不调用模型或写入数据库。

在下面命令中替换 worktree 的绝对路径及端口。首次运行创建任务空间，后续使用返回的 ID。每个分段单独执行，失败后修正原因并重新加载页面、按顺序重跑；不要把失败断言改成跳过。

```sh
ego-browser nodejs <<'JS'
const task = await useOrCreateTaskSpace('Composer 回归')
cliLog({ taskId: task.id })
await openOrReuseTab('http://localhost:4041/thread-chat-gate-3-harness/content', { wait: true })
const { runContentChecks } = await import('file:///绝对路径/e2e/thread-chat/content-browser.test.mjs')
await runContentChecks({ js, click, typeText, pressKey, wait, cdp, cliLog }, 'references')
JS
```

接下来复用任务空间和同一页面，依次运行 `drafts`、`attachments`、`editing`，每段调用相同的 `runContentChecks`。按键测试使用 macOS 的 Command 操作；测试会自行清理窄屏模拟。

覆盖：候选选择与空结果、引用点击预览、复制粘贴、删除/撤销、窄屏及缩放定位、Thread/视图草稿恢复、发送期间禁用、迟到成功保护、长短文本/文件/图片粘贴、同名文件拖入、上传失败重试与移除、混排历史消息编辑。文件选择入口可用 `uploadFile('input[type="file"]', '/绝对路径/fixture.txt')` 补充验收。

最后单独运行任务清理：

```sh
ego-browser nodejs <<'JS'
await completeTaskSpace('Composer 回归', { keep: false })
JS
```
