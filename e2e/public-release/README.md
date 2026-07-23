# public-release E2E 验收

该脚本覆盖 `prepare-public-release` 的公开页面与 signed-out 验收，不读取项目环境文件，也不需要数据库或模型密钥。

前提是应用已启动，且本机有可供 `playwright-core` 启动的 Chromium：

```bash
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
BASE_URL=http://localhost:3000 \
node e2e/public-release/verify-public-release.mjs
```

默认 `BASE_URL` 为 `http://localhost:3000`。检查项包括英文 H1、全部 `Start chatting` 和 GitHub 链接目标、首页无许可文案、1440px 与 390px 下无横向溢出及首屏 CTA 可见，以及 signed-out `/start-chat` 到 sign-in 的 redirect 参数。

如操作员已经在安全位置准备好一个已登录的 Playwright storage state，可额外验证连续两次 fresh start 都转到有效且不同的 UUID：

```bash
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
PLAYWRIGHT_STORAGE_STATE=/safe/path/auth-state.json \
node e2e/public-release/verify-public-release.mjs
```

脚本不会创建、修改或输出该状态文件；不要将它提交到仓库。未提供该变量时会明确输出 `SKIP`，因此默认只覆盖 signed-out 与公开 UI。
