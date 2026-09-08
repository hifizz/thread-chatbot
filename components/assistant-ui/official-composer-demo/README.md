# Assistant UI 官网 Composer 预览复刻

独立示例页直接渲染 GitHub 上的 `ComposerDemo`，保留官方源码和示例数据。Thread 底部使用同一套官方外壳与局部主题，不使用 iframe；当前已通过 `conversation-composer.tsx` 接入真实 Artifact 引用与发送。

## 源码依据

固定提交：`98010f17b4a8d4bc506a6084007ecdaf4a823503`。

[官方页面注册表](https://github.com/assistant-ui/assistant-ui/blob/98010f17b4a8d4bc506a6084007ecdaf4a823503/apps/docs/components/pages/elements/registry.tsx) 是实际预览组件的映射来源。页面上的 Runtime 标签不代表预览使用了文档正文中的运行时接法；这几个页面的预览指向下面的 Demo 文件。

| 页面 | GitHub 路径（相对于仓库根目录） | 本地入口 |
| --- | --- | --- |
| Composer（完整组合） | apps/docs/components/demo/elements/composer.tsx | /official-composer-demo |
| Slash commands | apps/docs/components/demo/elements/composer-slash.tsx | /official-composer-demo/examples/slash-commands |
| Mentions | apps/docs/components/demo/elements/composer-mentions.tsx | /official-composer-demo/examples/mentions |
| Attachments | apps/docs/components/demo/elements/composer-attachments.tsx | /official-composer-demo/examples/attachments |
| Model picker | apps/docs/components/demo/elements/composer-models.tsx | /official-composer-demo/examples/model-picker |
| Trigger popover | apps/docs/components/pages/docs/samples/composer-trigger-popover.tsx | /official-composer-demo/examples/trigger-popover |
| Mobile | apps/docs/components/demo/elements/mobile-composer.tsx | /official-composer-demo/mobile |

上述文件与配套 hooks、DemoStage、SampleFrame 原样复制，保留官方 import 路径。`upstream.json` 记录每个文件的 GitHub 路径和 SHA-256；核心组件还与相同提交下的 `packages/ui/src/components/react/assistant-ui/` 源码逐字节核对。

## 独立示例保留的官网行为

- 完整 Composer 原文件已经组合命令、人物、附件、模型菜单、语音模拟与 Context 弹窗；仅通过一行 export 挂载。
- 命令是 review / explain / branch / improve；选中后输入框显示 `/review ` 一类文本。
- 人物是 Mara / Max / Aiden / Ana；选中 Max 显示 `Ask @Max `，没有序列化指令。这是普通文本，不是不可编辑胶囊。
- 菜单首项高亮，Enter 选择首个匹配项；原示例没有上下键切换高亮的逻辑，本轮保留原样。
- 完整 Composer 默认附件是 screenshot.png（128 KB）；独立 Attachments 示例是 screenshot.png（128 KB）和 trace.log（38 KB），带模拟上传进度及删除按钮。加号恢复示例附件，不打开真实文件上传。
- 模型是 Fable 5 / Opus 5 / Haiku 4.5。
- Trigger Popover 官网预览本身是静态菜单展示，没有输入框或选择处理函数，单独原样展示。完整 Composer 使用其原有 ComposerMenu，不混入另一套运行时菜单。
- 发送只清空演示输入；不调用聊天接口。Mobile 附件回调原本为空。

## 样式隔离与验证

Thread 和独立示例共用 OfficialComposerTheme，加载与官网一致的 Public Sans / JetBrains Mono；CSS Module 从官网 globals.css 复制主题值并恢复官网圆角 token，避免宿主 shadcn 半径比例影响示例。官方 TSX 源码未修改。

通过 ego-browser 对照官网与本地的命令、人物、附件和模型独立示例，核对内容及计算样式（字体、字号、行高、字重、圆角、背景、前景、padding、gap、边框）。同时实测选择 Max、命令 Enter、模型切换、删除/恢复附件及发送清空。

原有 react-markdown@0.14.5 项目补丁保留，其 peer 范围仍有安装警告；这与本轮预览复刻无关。

## Thread Artifact 业务接入

- 官方 Composer / ComposerMenu 外壳组合项目现有的 Lexical 编辑器，沿用有序草稿和消息协议。
- `@` 搜索当前 Project 已完成的 Markdown Artifacts；首项高亮，支持上下键、Enter、Escape 和空结果提示。连续 `@@` 结束查询，退格回到单个 `@` 重新打开。
- 选中后插入带真实 Artifact ID 的不可编辑胶囊，点击打开现有预览面板。发送沿用服务端归属校验、引用保存及 Markdown 上下文展开。
- 成功发送清空草稿，失败保留输入与引用；已有消息重新编辑可恢复胶囊。未发送草稿的刷新恢复仍待后续 draft restore 阶段。
- 模型展示并切换当前会话的真实模型；Slash/Skill 及语音业务后续接入。

## Thread 附件业务接入

- 加号打开真实文件选择器，沿用文本、源码及 PNG/JPEG/WebP 图片的类型、大小、数量和模型能力限制。
- 官方 ComposerAttachments / ComposerAttachmentChip 展示文件名、大小、上传进度与状态；失败支持重试，上传中及完成后支持移除。
- 上传复用现有附件接口、图片预处理和对象存储链路；附件按独立 ID 管理，同名文件不会互相覆盖。
- 附件草稿与当前 Project 中的 Thread 一起保留，上传完成后以已有 file parts 协议随消息发送。失败保留草稿，成功清空；附件未就绪时不能发送。
- 附件以卡片显示在输入区上方，不插入正文胶囊；正文中的 Artifact 引用仍保持原有顺序。

验证涵盖 ego-browser 实际键盘选择、胶囊光标行为、预览、失败重试、真实发送与刷新恢复，以及引用匹配、消息编解码、上下文展开和数据库集成测试。

## Thread 模型选择接入

- `composer-model-selector.tsx` 复用官方 ComposerMenu / ComposerModelItem / ComposerModelTrigger；Base UI 提供键盘导航、外部点击关闭、Escape、焦点归还和视口定位，长列表可滚动。不加 Provider logo 或分组，独立官方示例保留原件。
- 模型名称、稳定公开 ID、上游 ID、能力和暂定 context 展示值集中在 `constants/models/token-router.ts` 的一次 `defineProviderModels` 中。context 仅供菜单展示，不参与真实 token 预算。
- Thread 和其他模型选择入口只使用该目录的 18 个模型，默认 Luna。其他 provider 的代码和历史注册暂留，退役另做；旧 Iceland / Private Relay 目录从新目录派生，避免重复维护模型。
- `lib/ai/llm/token-router.ts` 统一使用 `TOKEN_ROUTER_BASE_URL` / `TOKEN_ROUTER_API_KEY`，Claude 走 Messages，其他模型走 Chat Completions。原有公开 ID 保留，已有会话无需迁移；标题生成同样走注册路由的 Luna。
- 选择沿用会话更新命令；模型保存期间阻止再次切换和发送，失败保留原模型与草稿。分支及回复生成中的切换限制不变。
- 新中转的 Claude 显式缓存尚未做真实验证，不继承旧 Iceland 专属缓存白名单。

验收时先切换模型并检查按钮名称与选中标记，再用 Luna 发送短消息，刷新确认模型和回复仍在；检查生成中禁用切换，以及断网切换失败后保留原模型与输入。非主线分支的模型、Effort 和 Max 统一禁用并灰显，悬停显示禁止光标与无箭头原因提示；禁用选项的外层支持键盘聚焦读取提示。路由与协议自动检查入口为 `pnpm test:thread-chat:model-routes`。

## Thread 生成参数恢复

- 新 composer 复用 `GenerationSettingsControls` 与已有会话级参数上下文，默认 `high / 32K`。按当前模型能力展示 Effort、Max；发送中和模型保存中禁用。工具栏始终单行，发送按钮固定在右侧；窄列隐藏参数标签前缀，左侧选项溢出时可横向滚动，菜单通过 Portal 展示。
- 输入区初始为一行（20px），随内容增长，清空后回缩；输入区与28px工具栏之间不额外加 gap。外框悬停及内部编辑器、按钮聚焦时沿用当前列主题边框色，失焦且移开后恢复。
- 显示与发送共用有效值解析；切换模型后，不支持的偏好回退到该模型的默认档位。服务端继续独立校验；发送、重试、编辑与分支路径沿用同一入口。
- GPT 参数转换为 `reasoning_effort` / `max_completion_tokens`，后者包含推理 token；Claude 继续使用 adaptive thinking。Effort 不等于保证返回可显示的 reasoning，内容展示取决于中转响应。
- 能力档位和 SDK 请求体由 generation-settings / model-routes 测试覆盖；Luna 使用真实 Markdown 与 PNG 附件、`low / 16K` 验收。
