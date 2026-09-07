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
- 模型展示当前会话的真实模型；模型选择、Slash/Skill、附件上传及语音业务后续接入。

验证涵盖 ego-browser 实际键盘选择、胶囊光标行为、预览、失败重试、真实发送与刷新恢复，以及引用匹配、消息编解码、上下文展开和数据库集成测试。
