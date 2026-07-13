# 任务拆解：会话列表 UI

## 1. DB 层

- [x] 1.1 `lib/db/schema.ts` 的 branchTrees 加 `customTitle: text("custom_title")` 可空列（注释说明双轨标题，见 design D1）；`pnpm db:generate` 生成 0005 迁移并 `pnpm db:migrate` 应用；SQL 确认列已加

## 2. API

- [x] 2.1 新增 `app/api/branch-trees/route.ts`：GET 列表——一条查询取 `id / coalesce(custom_title, title) as title / updated_at / threadCount(jsonb_object_keys 计数)`，updated_at 降序 limit 100，不回传 state；title 双空回退「未命名对话」
- [x] 2.2 `app/api/branch-trees/[treeId]/route.ts` 增加：PATCH（body `{title}`，trim 非空且 ≤60 否则 400、树不存在 404，只写 custom_title）；DELETE（幂等，返回 `{ok:true}`）。UUID 校验沿用现有安全阀
- [x] 2.3 确认 PUT upsert 不触碰 custom_title（现实现只 set state/title/updatedAt——核对即可，应无需改动）
- [x] 2.4 curl 冒烟：列表形状与排序；PATCH 后列表展示新名、继续 PUT 后名字不被覆盖（D1 关键路径）；PATCH 空白/超长 400；DELETE 后列表消失、再 DELETE 仍 200

## 3. 前端

- [x] 3.1 `net/persist.ts` 增加 `listTrees()` / `renameTree(id, title)` / `deleteTree(id)`（失败 console.warn/抛给调用方做回滚，风格与现有函数一致）；`clearUiState(id)` 与「最近一棵若指向则清除」的删除善后工具
- [x] 3.2 新增 `orchestration/tree-list.tsx`：swx 语言弹层——条目（展示标题/相对时间/分支数徽标）、当前树高亮置顶（未入库合成「未保存」条目）、点击跳转（当前树仅关闭）、悬停铅笔/垃圾桶、内联重命名（Enter/Esc，乐观更新失败回滚+toast）、二段删除确认（点它处/Esc 复位）；相对时间格式化函数就近放组件内或 lib/（若已有类似工具先复用）
- [x] 3.3 壳层接线：顶栏「对话列表」tbtn（新对话旁）、⌘⇧K 打开、Esc 关闭链把弹层放最外层；删除当前树的跳转链（剩余最近一棵 / 新 UUID）+ localStorage 善后（调 3.1 工具）
- [x] 3.4 `thread-chat.css` 追加弹层条目/徽标/内联输入/确认态样式（沿用 .tc token 与 swx 既有观感）

## 4. 验收（真实执行，全绿才算完）

- [x] 4.1 `pnpm typecheck` 0 错误；`npx eslint app/thread-chat app/api lib` 0 报错
- [x] 4.2 e2e：新增 `e2e/thread-chat/verify-tree-list.mjs`（playwright + 直连 DB，测试行自动清理，风格照 verify-persist.mjs）覆盖：造两棵树 → ⌘⇧K 打开列表（两棵+当前未保存条目）→ 点击切换恢复 → 重命名后（含**继续聊天触发 PUT 后名字不被覆盖**）→ 二段删除非当前树 → 删除当前树跳转剩余最近一棵 → localStorage 善后断言
- [x] 4.3 回归：`verify-persist.mjs` 17 断言与 `verify-live.mjs` 22 断言全 PASS
- [x] 4.4 `pnpm build` 通过（新路由/新列参与构建）

## 5. 文档与收尾

- [x] 5.1 `e2e/thread-chat/README.md` 补 verify-tree-list 一段
- [x] 5.2 仓库根 `CLAUDE.md` 持久化小节补一句（custom_title 双轨与列表 API）
- [x] 5.3 `pnpm openspec:validate` 通过；prettier 提交前统一跑（主循环做）
