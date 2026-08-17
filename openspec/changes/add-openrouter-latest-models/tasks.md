## 1. 模型注册与展示

- [x] 1.1 在 OpenRouter slug 白名单和共享模型注册表中加入 Qwen3.8 Max、Grok 4.5、Grok 4.6，保持专属 provider、原生 reasoning 与唯一内部 id。
- [x] 1.2 扩展 Thread Chat 模型选择器的品牌排序和展示 creator 类型，使三项模型以预期顺序出现。

## 2. 计费与文档

- [x] 2.1 为三项新增内部 id 添加非零 USD 静态回退价；Grok 使用 200K 以上最高公开阶梯。
- [x] 2.2 更新中英文 README 的固定 OpenRouter 内部模型目录与 GLM 5.3 不可用边界。

## 3. 验证

- [x] 3.1 扩展 OpenRouter 注册表回归测试，覆盖精确 slug、13 项可见模型、唯一性和非零回退价。
- [x] 3.2 运行相关 Node 测试、`pnpm typecheck`、`pnpm lint`、`pnpm build` 与 `pnpm openspec:validate`。
