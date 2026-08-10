## 1. 必要性与供应商门槛

- [ ] 1.1 用前三批的真实数据列出“因 JavaScript/安全展开导致 search + extract 无法取证”的重复场景、占比和用户价值；未达到审批门槛则停止本 change
- [ ] 1.2 明确定稿第一版 approved read goals/source classes、单次最高价、时限、cohort flag 和独立 kill switch
- [ ] 1.3 将 Vercel CLI 升级到当时最新版本，重新 discovery `web-automation`，对 Browserbase 等候选和 Vercel Sandbox 自管方案做安全/隐私/成本评审
- [ ] 1.4 经用户完成选定 Marketplace integration 的安装/授权；如选择自管 Playwright，先开通 Vercel Sandbox，均不得把 provider secret 暴露给客户端/模型

## 2. 隔离任务与工具契约

- [ ] 2.1 定义 hosted-browser/sandbox adapter、ephemeral session lifecycle、取消/超时和 sanitized result contract
- [ ] 2.2 实现 `browseSource({sourceId, goal})` 严格 schema，仅接受本响应已验证来源和 approved goal，拒绝 URL/JS/selector/shell/action list
- [ ] 2.3 实现固定只读 workflow：navigate、有限 wait、可选安全 disclosure expand、visible main text extract、cleanup
- [ ] 2.4 确保 sandbox 环境不注入 DB/auth/LLM/search/payment secrets，不挂载主应用文件系统，不继承用户 cookie/storage/cache

## 3. 网络、动作与资源策略

- [ ] 3.1 配置 deny-by-default egress，只允许验证后的目标 origin 和最小静态资源 origin；DNS/redirect 每跳复验并阻断 internal/metadata/private/reserved 地址
- [ ] 3.2 阻断 popup/new tab/cross-origin navigation/download/non-HTTP(S)，为每个 blocked action 写安全事件
- [ ] 3.3 阻断 login、permission、form fill/submit、upload、payment 和所有外部 mutation；safe expand 仅允许批准的非提交语义
- [ ] 3.4 设置单响应最多 1 task 及 wall-clock/navigation/request/byte/DOM/text/CPU-memory（provider 支持时）硬限制，任一超限立即终止

## 4. 结果净化、UI 与计费

- [ ] 4.1 从浏览器结果中移除 scripts/forms/handlers/hidden controls/storage/traces，只返回 bounded visible text、canonical URL/title/time 和安全元数据
- [ ] 4.2 把浏览器文本标记为不可信证据，验证页面提示注入不能扩大工具、网络或指令权限
- [ ] 4.3 增加“浏览器访问”独立进度、失败/限制 UI，与“搜索”“读取来源”清晰区分
- [ ] 4.4 增加 browser runtime/network/session 的 admission reservation、external usage、cost/price、termination/blocked request 审计和用户汇总

## 5. 对抗验证与发布

- [ ] 5.1 建立专用恶意测试页，覆盖 private redirect、DNS rebinding 能力边界、cross-origin、download、form mutation、popup、prompt injection 和无限资源
- [ ] 5.2 覆盖 client abort、server timeout、provider failure、cleanup、并发 admission、cost cap 和 kill switch，验证无残留 session/credential/storage
- [ ] 5.3 用 GLM-5.2 目标编程集验证浏览器只在 approved gap 触发，答案/引用收益足以覆盖延迟与费用
- [ ] 5.4 运行 `pnpm typecheck`、`pnpm lint`、全部安全/计费/e2e、`pnpm build` 和 `openspec validate add-sandboxed-browser-retrieval --strict`
- [ ] 5.5 仅对内部 allowlist 开启，再小 cohort 灰度；演练独立 kill switch 后才允许扩大范围

## 6. Research 与 ADR 维护

- [ ] 6.1 将 coverage-gap、apply 时 Marketplace/Sandbox 对比、威胁测试、session cleanup、延迟和成本数据回填 `research/README.md`
- [ ] 6.2 只有 go/no-go 审批通过才将 ADR 标为 `Accepted`；provider、egress 或 approved goal 变化必须新增 ADR 并重新安全评审
