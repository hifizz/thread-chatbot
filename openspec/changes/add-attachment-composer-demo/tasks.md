# 任务拆解：Attachment Composer 纯前端演示

## 1. Demo 数据模型与纯函数

- [ ] 1.1 新建 `app/thread-chat/chat/composer/attachment-composer-demo-model.ts`，定义 `DemoAttachmentSource`、`DemoAttachment` 与受控 Props 所需类型
- [ ] 1.2 实现 `createDemoAttachments(files, source)`：保持输入顺序、每次使用 `crypto.randomUUID()`、不按文件名或 File 对象去重
- [ ] 1.3 实现 `createPastedTextAttachment(text, now?)`：空白返回 `null`；非空创建 `text/plain` 的 `pasted-text-{timestamp}.txt`，内容保留原始文本
- [ ] 1.4 实现 immutable 的 append/remove helper；确认不修改调用方传入数组

## 2. 受控 Attachment Composer 组件

- [ ] 2.1 新建 `app/thread-chat/chat/composer/attachment-composer-demo.tsx`，实现 `attachments/onChange` 受控契约与唯一 `emitChange(next)` 更新入口
- [ ] 2.2 使用 `components/ui/attachment.tsx` 的 `AttachmentGroup`、Attachment Item、标题截断和操作区；加号沿用 assistant-ui 的按钮/Tooltip 视觉，不搭建 Assistant Runtime
- [ ] 2.3 实现顶部单行 Attachment Tray：`w-full min-w-0`、Item 不收缩、超出横向滚动、长文件名截断、空列表不占高度
- [ ] 2.4 实现每个附件的通用文件图标、文件名、可选类型/大小说明和单项 Remove；Remove 为 `type="button"`，不触发 Picker 或其他动作
- [ ] 2.5 保留普通 textarea；普通逐字输入只更新文本，不创建附件；发送控件省略或禁用/no-op，禁止调用 `/api/chat`

## 3. Picker / Drop / Paste 入口

- [ ] 3.1 左下角新增 `+`：代理隐藏的 `<input type="file" multiple>`，不设置业务 `accept`，一次选择全部追加为 `source: "picker"`
- [ ] 3.2 Picker 处理完成后清空 `input.value`，验证再次选择同一文件仍新增独立附件
- [ ] 3.3 实现多文件 Drag & Drop：`dragover/drop` 阻止默认导航；按 DataTransfer 顺序一次追加；使用 drag depth 或等价逻辑避免子节点移动导致状态闪烁
- [ ] 3.4 实现 Paste File/Image：收集所有 `kind === "file"` 且 `getAsFile()` 非空的项，文件存在时一次追加并停止处理文本
- [ ] 3.5 实现 Paste Text：仅在无文件项时读取 `text/plain`；非空转一个 synthetic `.txt` attachment，并阻止文本写入 textarea；空白不触发变化
- [ ] 3.6 确认一次 Picker/Drop/Paste 多文件操作只调用一次 `onChange`

## 4. 独立 Demo 页面

- [ ] 4.1 新建 `app/thread-chat/attachment-composer-demo/page.tsx`，由页面持有 `DemoAttachment[]` 本地 state
- [ ] 4.2 实现 `handleChange(next)`：同步 `setAttachments(next)` 并执行 `console.log("attachments changed", next)`
- [ ] 4.3 页面展示简短说明和可选附件数量调试信息，不接业务 Store、Assistant Runtime、上传 Adapter 或后端 API
- [ ] 4.4 不将 Demo 入口加入正式产品导航；确认路由在现有 ThreadChat 登录与主题环境中可直接访问

## 5. 自动验证

- [ ] 5.1 新建 `e2e/thread-chat/attachment-composer-demo-model.test.mjs`，覆盖顺序、唯一 ID、append/remove immutable、同名不去重、synthetic File 内容/MIME/命名和空白文本
- [ ] 5.2 新建 `e2e/thread-chat/verify-attachment-composer-demo.mjs`，按项目现有 `playwright-core` 模式验证：multi-select、重复选择、Drop 多文件、Paste 文件优先、Paste Text、Remove、普通打字和 10+ Item 横向溢出
- [ ] 5.3 浏览器脚本监听请求，断言交互期间不存在 `/api/attachments`、ingest、对象存储 PUT、附件 DELETE 和 `/api/chat`
- [ ] 5.4 若 Chromium 无法向 ClipboardEvent 构造器注入 DataTransfer，改为在页面内调用同一 Paste 归一化路径，并补充手工截图/文本 Paste 清单；不新增测试框架
- [ ] 5.5 视需要在 `package.json` 增加 `test:attachment-composer-demo` 命令，串行运行 model test 与 browser verify；不新增依赖

## 6. 质量门禁与交付证据

- [ ] 6.1 运行 `pnpm typecheck`，修复全部错误
- [ ] 6.2 运行 `pnpm lint` 或至少对新增文件执行 ESLint，0 error
- [ ] 6.3 运行 `pnpm build`，确认 Demo route 可被 Next.js 16 正常构建
- [ ] 6.4 运行 `pnpm openspec:validate`，确认本 Change 与全部 OpenSpec 严格校验通过
- [ ] 6.5 手工验收 Picker、Drop、系统截图 Paste、普通文本 Paste、Remove、横向滚动和 Network 面板零附件业务请求
- [ ] 6.6 PR 描述附 Demo 路由、自动测试结果、Build/Typecheck/Lint/OpenSpec 结果，以及本期明确未实现的后端和完整 Composer 能力
