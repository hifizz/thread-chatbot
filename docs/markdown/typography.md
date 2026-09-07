# Markdown 字体选择记录

记录日期：2026-09-07。

## 当前选择

- 英文标题（h1–h6）：Brawler，加载 400、700 字重。
- 英文正文与表格：Lora，加载 500、600、700 字重及对应斜体。正文 CSS 仍为 400，匹配到 Lora 500，让英文更厚实，同时保持中文原有字重。
- 中文正文与表格：默认 Noto Sans SC，可通过右下角选择框试读 Noto Serif SC、霞鹜文楷、霞鹜新晰黑；中文标题继续使用原有系统字体。
- 表格默认字号：16px；紧凑模式保留 12px。
- 行内代码：继续使用原有等宽字体。代码块默认 Fira Code，可独立切换其他等宽字体。

## 标题字体对比

在相同的 Markdown 标题样式下先试用 Alike，再试用 Brawler，最终选择 Brawler。

| 比较项 | Alike | Brawler |
| --- | --- | --- |
| 官方设计定位 | 低对比、比例规整，字形较柔和，面向舒适阅读 | 紧凑、棱角鲜明，最初面向报刊，强调小字号阅读 |
| 本次试用的视觉感受 | 较温和，偏书籍气质 | 更扎实、醒目，偏报刊气质 |
| 当前项目的 next/font/google 可用字重 | 400 | 400、700 |
| 现有加粗标题下的表现 | 浏览器模拟加粗 | 匹配真实的 700 粗体 |

选择理由：Brawler 搭配 Lora 正文时，标题与正文的层次更明确，并且可以使用真实粗体。用户对比后确认采用第二款 Brawler。视觉感受是本次试用判断；两次试用同时存在字形和真实／模拟粗体的差异。

字重列表描述的是本次项目接口，不是字体的全部上游版本。Cyreal 官网的 Brawler 另列有 Medium、SemiBold；当前接入仍使用项目支持的 400、700。

## 授权与来源

三款字体均属于 Cyreal 发布的字体项目，但具体设计者不同：Alike 为 Sveta Sebyakina，Brawler 为 Oleg Frolov，Lora 为 Alexei Vanyashin 和 Olga Karpushina。

均采用 SIL Open Font License 1.1，可免费用于商业网站及嵌入软件。分发字体时需保留版权和许可证，不能将字体本身单独出售；修改字体时还需遵守保留名称等条款。

- [Alike 官方介绍与授权](https://www.cyreal.org/fonts/alike/)
- [Brawler 官方介绍与授权](https://www.cyreal.org/fonts/brawler/)
- [Lora 官方介绍与授权](https://www.cyreal.org/fonts/lora/)
- [SIL OFL 1.1 授权原文](https://openfontlicense.org/open-font-license-official-text/)

## 实现位置

- `app/layout.tsx`：字体加载和 CSS 变量注册。
- `app/thread-chat/styles/tokens/typography.css`：正文、标题字体 token 与中文回退。
- `app/thread-chat/styles/markdown.css`：Markdown 标题、正文、表格应用字体。
- `app/thread-chat/styles/tokens/prose.css`：表格字号。

本次已通过类型检查，显示效果由用户在页面对比确认。

## 中文字体试读控件

右下角「中文正文」选择框仅修改正文与表格的中文字体，保留 Lora 英文、Brawler 标题和等宽代码。选择保存在当前浏览器；字体加载成功后才应用，失败时保留之前的字体并显示提示。

Noto 系列由 `next/font/google` 提供。霞鹜文楷 v1.522 的 Regular、Medium 从官方 TTF 压缩为 WOFF2；霞鹜新晰黑 v1.305 保留官方 TTF。字体按需加载，本地资源和许可见 `public/fonts/markdown/`。

新晰黑使用 IPA Font License 1.0；选择框额外提供「IPAex Gothic（恢复原始字体）」，使用随项目附带的原始 IPAex Gothic 004.01，以便用户停止使用衍生字体。字体许可与恢复说明可从控件打开。该额外选项用于恢复，不属于四款试读候选。

霞鹜文楷的常规与 Medium 字重、新晰黑的单一字重，与 Noto 系列的可变字重不同；加粗效果不应视为完全相同的字重对比。

## 代码块字体选择

同一右下角面板增加独立的「代码块」选择框：Fira Code、JetBrains Mono、Menlo、Monaco、Courier New、系统等宽字体。

默认回退顺序为 Fira Code → JetBrains Mono → Menlo → Monaco → Courier New → monospace。前两款通过 `next/font/google` 自托管，JetBrains Mono 同时加载常规和斜体。后三款命名字体使用设备已有字体，未安装时按等宽字体栈回退；系统等宽选项由浏览器决定字体。

选择仅应用于 `.tc-prose .md-code code`，不改变正文、标题、行内代码、代码块语言标签或其他界面文字。使用独立的 `thread-chat:code-font` 浏览器存储键，和中文字体选择互不影响。加载与记忆逻辑由 `hooks/use-preview-font.ts` 共用。
