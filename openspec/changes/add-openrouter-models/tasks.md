## 1. 依赖与模型领域类型

- [x] 1.1 使用 pnpm 增加支持 `ai@^7` 的稳定版 `@openrouter/ai-sdk-provider` 直接依赖，并确认 Node/ESM要求与当前 Next.js 构建环境兼容
- [x] 1.2 在 `constants/model.ts` 定义 10 个准确的 `OpenRouterModelId`、内部 `openrouter-*` id 映射及 `openrouter` 调用 provider，保证内部 id 全站唯一
- [x] 1.3 将 `reasoning?: boolean` 收敛为可区分 `think-tags` 与 `native` 的类型，迁移 MiniMax 现有标记并保证只有 `think-tags` 使用抽取中间件
- [x] 1.4 显式建模模型可见面（或以等价的注册表单一来源方式）把 10 个 OpenRouter 模型纳入 `THREAD_CHAT_MODELS`，不在 selector 复制 id 列表
- [x] 1.5 增加纯校验，覆盖 OpenRouter 模型数量、内部 id 唯一性、slug 精确映射、Thread 可见性以及与 Ark `deepseek-v4-flash` 并存

## 2. OpenRouter 专属 provider

- [x] 2.1 新增 `lib/ai/openrouter.ts`，实现 `isOpenRouterConfigured()` 与接受 `OpenRouterModelId` 的 `openRouterChatModel()`，仅从服务端读取 `OPENROUTER_API_KEY`
- [x] 2.2 在专属 provider 模型设置中开启 usage accounting，并仅在值非空时发送 `OPENROUTER_HTTP_REFERER`、`OPENROUTER_APP_TITLE` 归因 header
- [x] 2.3 实现 `openRouterCostUsdFromSteps()` 纯函数：校验 steps 非空、每一步 cost 为有限非负 number、接受零值、完整时求和、任一步缺失/非法时整次返回 null
- [x] 2.4 修改 `lib/ai/provider.ts`：OpenRouter 注册项固定短路到专属 provider；缺 key 返回可读错误；既有 MiniMax/Ark/Vercel/CF/直连路径与优先级保持不变
- [x] 2.5 为成本解析和路由边界增加验证，覆盖单步、多步、零值、部分缺失、负数、字符串、NaN/Infinity 及多种网关凭据同时存在

## 3. 计费证据与保守价格

- [x] 3.1 在 `constants/pricing.ts` 为 10 个内部 id 增加非零 USD 回退成本，GPT 系列使用当前最高已知长上下文阶梯价，Kimi/DeepSeek 使用当前公开价
- [x] 3.2 为 `chargeUsage` 定义 `UsageCostEvidence` 判别联合，并兼容缺省 estimate、Vercel generation id 和 OpenRouter真实美元成本三种输入
- [x] 3.3 修改 `chargeUsage`：OpenRouter真实成本通过既有美元换算与利润率公式即时计算，在同一事务中扣余额、写流水并返回成本来源；元数据不可用时使用静态估值
- [x] 3.4 将 `usage_records.costSource` 类型扩展为 `estimate | gateway | openrouter`，确认底层 `text` 无需 DDL migration，且 Vercel reconcile 只扫描 estimate + generation id
- [x] 3.5 增加计费验证，覆盖真实成本、保守回退、至少 30% 利润率、OpenRouter 行无 generation id、不参与 Vercel reconcile 以及所有新增模型不会按零价计费

## 4. Chat route 与流式生命周期

- [x] 4.1 保持 `/api/chat` 的 `modelId?: unknown` 边界：内部 id 正常解析，外部 OpenRouter slug、非字符串和未知 id 返回 400，客户端附带的 provider/reasoning/plugin/cost 覆盖不生效
- [x] 4.2 将生成结束回调切换到 AI SDK v7 的 `onEnd`，对 OpenRouter 模型从全部 `steps` 聚合成本证据，再与聚合 token usage 一并交给 `chargeUsage`
- [x] 4.3 保留客户端断开后服务端 `consumeStream` 完成计费、流内错误日志/掩码及失败生成不触发完成计费的既有语义
- [x] 4.4 验证 OpenRouter native reasoning 不经过 `<think>` 中间件，reasoning parts、usage、Markdown Artifact 工具调用和最多 5 步停止条件继续工作

## 5. Thread 选择、持久化与展示

- [x] 5.1 更新 Thread 模型 selector 的品牌排序/展示，使 GPT-5.6、GPT-5.5、Kimi K3、DeepSeek V4 Flash 0731 以预期名称出现，Pro 保持独立选项
- [x] 5.2 验证根 Thread 切换后下一条请求立即使用新增模型，刷新后保持内部 id，分支继承直接父 Thread 模型并继续锁定
- [x] 5.3 验证旧树缺失/未知/已移除 OpenRouter id 时只回退默认模型，不丢失消息、Artifact 或分支
- [x] 5.4 确认新增模型虽具有多模态能力，本 change 仍沿用现有附件文本化路径，不意外开放 provider-specific 文件输入

## 6. 配置与文档

- [x] 6.1 更新 `.env.example`，加入必需 `OPENROUTER_API_KEY` 和可选 `OPENROUTER_HTTP_REFERER`/`OPENROUTER_APP_TITLE`，不包含真实密钥
- [x] 6.2 更新 `README.md`、`README.zh-CN.md` 与相关 AI 后端说明，记录 10 个内部模型 id、OpenRouter配置、固定路由、真实成本/回退计费及不支持任意 slug
- [x] 6.3 扫描注释和文档中已过期的“Thread Chat 仅 Ark/MiniMax”或 `reasoning` 布尔语义，并只修正本 change 影响的内容

## 7. 验证与交付

- [x] 7.1 扩展现有 Node e2e/纯状态验证，覆盖注册表、Thread 模型选择、成本解析、计费来源和未知 id 拒绝
- [x] 7.2 使用真实 OpenRouter key 对 GPT-5.6 Luna、Kimi K3、DeepSeek V4 Flash 0731 运行流式文本与至少一次工具调用 smoke；记录 GPT-5.5 Pro 为高成本手工验证项
- [x] 7.3 分批运行 `pnpm typecheck`，最终运行相关 e2e、`pnpm lint` 与 `pnpm build` 并修复本 change 引入的问题
- [x] 7.4 运行 `pnpm openspec:validate`（必要时再执行 OpenSpec strict validation），确认 proposal、design、spec、plan 与 tasks 一致且 apply-ready
