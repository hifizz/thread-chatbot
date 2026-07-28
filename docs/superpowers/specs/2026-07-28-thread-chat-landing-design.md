# Thread Chat 精品首页设计

## 目标

以 Minttr 的“产品演示先行、编辑式叙事跟随”的页面节奏为参考，重做 Thread Chat 首页。页面不复用当前首页的纸张网格、手绘标识、复杂导航、展示组件或卡片式功能区，也不复制 Minttr 的手写字体、插画和卡片皮肤。

首页的任务是让访客快速理解：Thread Chat 让 AI 对话中的分叉思考可见、可回到主线、可长期保存。

## 视觉系统

复用 thread-chat 页面已有主题，而非另起一套品牌色：

- 背景：`#f5f2ea`
- 正文：`#24211b`
- 次级文字：`#6a6357`
- 分隔线：`#e2dccd`
- 主交互与按钮：`#2f7d6b`
- 字体：沿用 thread-chat 的系统无衬线 UI 栈；标签或提示信息可使用现有等宽字体。

页面采用宽视频、窄文稿、克制留白的编辑式版面。所有主要按钮使用绿色实底与白字；悬停时加深并产生轻微位移。无需衬线字体、手写字体、纹理背景或插画。

## 页面结构与内容

1. **导航**：左侧 Thread Chat 标识；右侧唯一 `Get started` 按钮，指向现有开始聊天入口。
2. **视频 Hero**：最大宽度 1180px 的 `16:9` 容器，视频左下角显示 `Your thoughts are allowed to branch.`。视频文件尚未提供时，显示同尺寸暖黄占位，不使布局跳动。
3. **产品声明**：标题为 `Thread Chat` 和 `Think past the first answer.`；说明为 `A workspace for following the interesting parts of an AI conversation without losing the original thread.`。
4. **Why I built this**：说明常规聊天工具善于回答，但真正的思考会从一句话生出新问题，临时追问会打断或淹没主线。
5. **Why not existing chat**：直接说明 ChatGPT、Codex 的 thread 或 branch 不能替代可持续的思考结构。Thread Chat 的差异包括锚点上下文继承、主线保持清晰、树与工作台持久化、重要分支可沉淀为 Markdown。
6. **CTA**：文案为 `Follow your next question`，仍指向开始聊天入口。
7. **Footer**：产品名、`Built for curiosity with a long memory.`、GitHub、Privacy、Terms 和当前版权年份。

## 响应式行为

- 桌面：视频最大宽 1180px；文本内容最大宽约 700px。
- 移动端：侧边距 20px；导航只显示标识与 CTA；视频全宽；功能内容按阅读顺序单列堆叠；底部 CTA 全宽。
- Hero 视频使用 `object-fit: cover`；配置 `muted`、`loop`、`playsInline` 以支持移动端自动播放。视频须有描述性 `aria-label` 或同等替代文本。

## 组件与数据边界

首页由独立 section 组件组成：`LandingHeader`、`VideoHero`、`ProductStatement`、`FounderStory`、`WhyNotExistingTools`、`ClosingCta`、`LandingFooter`。

产品文案、CTA 链接、视频路径及页脚链接集中在 `constants/landing.ts`。组件仅负责结构和样式。视频文件放入 `public/`，通过一个常量替换路径；在资源缺失或浏览器不支持播放时，呈现静态占位与标题，页面仍可阅读和导航。

## 验证范围

- 运行 TypeScript 检查，保证组件和常量类型正确。
- 运行生产构建，验证 App Router 的页面与 metadata 输出。
- 在桌面与 375px 宽度下验证导航、视频比例、文字不溢出、CTA 可触达。
- 确认视频无法加载时不出现空白或破损控件。
- 检查键盘焦点、链接名称与视频替代文本。

## 非目标

- 本次不制作或编辑最终 MP4。
- 不新增登录、分析、表单、CMS 或第三方服务。
- 不重构 thread-chat 产品页及其主题。
