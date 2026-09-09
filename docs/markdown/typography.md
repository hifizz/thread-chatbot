# Markdown 字体选择记录

更新日期：2026-09-09。

## 正式默认配置

| 用途 | 字体 | 加载方式 |
| --- | --- | --- |
| 中文正文、表格、用户消息及中文标题回退 | Noto Sans SC | `next/font/google` |
| 英文正文、表格、用户消息 | Merriweather | `next/font/google`，常规与斜体 |
| 英文标题 h1–h6 | PT Serif | `next/font/google`，400、700，常规与斜体 |
| 代码块 | Hack 3.3.0 | `next/font/local`，400、700，常规与斜体 |

正文常规字重保持 400；表格默认 16px，紧凑模式 12px。表格保留外框与行分隔线，移除列间竖线。行内代码及界面字体保持原有配置。

`app/fonts.ts` 集中声明正式字体，`app/layout.tsx` 只挂载变量；语义用途在 `styles/tokens/typography.css` 定义。英文和标题字体关闭自动 Arial 回退，让中文字符落到显式配置的 Noto Sans SC。中文分片与代码字体按需加载，避免预加载整套中文字体。

Google 字体由 Next.js 在构建时下载，随静态资源由本站提供。构建机器需能连接 Google Fonts；访问网站的浏览器无需连接 Google，不配置第三方字体代理。云服务器运行阶段不需要从 Google 拉取正式字体。

## 开发面板边界

字体面板只在 `NODE_ENV=development` 且页面地址为 `localhost`、`127.0.0.1` 或 `[::1]` 时挂载。生产构建不挂载面板，也不读取字体试读存储，不恢复开发时的覆盖设置。非本地地址即使运行开发服务器也不显示面板。

候选字体声明独立于正式配置，位于 `orchestration/overlays/preview-fonts.ts`，由开发面板加载；试读控件、动态 Google 加载与浏览器偏好仍各自保留现有职责。开发环境已有偏好会继续生效，可在面板恢复预设后比较正式默认效果。

## 正式字体许可证

Noto Sans SC、PT Serif、Merriweather 采用 SIL OFL 1.1，允许商业网站使用及嵌入分发；分发须保留版权和许可证，不能单独销售字体，修改字体还需遵守保留名称等限制。原始文本保存在 `public/fonts/licenses/`。

Hack 使用其组合许可（MIT、Bitstream Vera 条款及 DejaVu 的公有领域声明），允许网站使用及分发，完整未修改声明保存在 `public/fonts/hack/LICENSE.md`。字体许可独立于项目代码的 AGPL 许可。

- [Next.js 字体优化](https://nextjs.org/docs/app/getting-started/fonts)
- [Noto Sans SC 许可](https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt)
- [PT Serif 许可](https://github.com/google/fonts/blob/main/ofl/ptserif/OFL.txt)
- [Merriweather 许可](https://github.com/google/fonts/blob/main/ofl/merriweather/OFL.txt)
- [Hack 许可](https://github.com/source-foundry/Hack/blob/master/LICENSE.md)

以下保留前期试读对比记录，正式默认值以上表为准。

## 标题字体对比

在相同的 Markdown 标题样式下先试用 Alike，再试用 Brawler，当时选择 Brawler（现已改为 PT Serif）。

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

- `app/fonts.ts`：正式字体加载；`app/layout.tsx`：CSS 变量挂载。
- `app/thread-chat/styles/tokens/typography.css`：正文、标题字体 token 与中文回退。
- `app/thread-chat/styles/markdown.css`：Markdown 标题、正文、表格应用字体。
- `app/thread-chat/styles/tokens/prose.css`：表格字号。

本次已通过类型检查，显示效果由用户在页面对比确认。

## 中文字体试读控件

右下角「中文正文」选择框同步修改正文、表格与用户消息气泡的中文字体，保留独立选择的英文、标题和代码字体。用户消息气泡共用正文的字体 token，原有字号、行高和纯文本呈现方式保持不变。选择保存在当前浏览器；字体加载成功后才应用，失败时保留之前的字体并显示提示。

Noto 系列由 `next/font/google` 提供。霞鹜文楷 v1.522 的 Regular、Medium 从官方 TTF 压缩为 WOFF2；霞鹜新晰黑 v1.305 保留官方 TTF。字体按需加载，本地资源和许可见 `public/fonts/markdown/`。

新晰黑使用 IPA Font License 1.0；选择框额外提供「IPAex Gothic（恢复原始字体）」，使用随项目附带的原始 IPAex Gothic 004.01，以便用户停止使用衍生字体。字体许可与恢复说明可从控件打开。该额外选项用于恢复，不属于四款试读候选。

霞鹜文楷的常规与 Medium 字重、新晰黑的单一字重，与 Noto 系列的可变字重不同；加粗效果不应视为完全相同的字重对比。

思源宋体（Noto Serif SC）曾试读 500 Medium，用户比较后选择恢复 400 Regular；内置选项与动态加载均保持常规 400、加粗 700，不额外加厚中文正文。

## 代码块字体选择

同一右下角面板增加独立的「代码块」选择框：Fira Code、JetBrains Mono、Hack、Menlo、Monaco、Courier New、系统等宽字体。

Hack 使用官方推荐 jsDelivr 提供的 `hack-font@3.3.0`，四款 WOFF2（常规、粗体、斜体、粗斜体）及完整许可保存在 `public/fonts/hack/`，由本站按需加载。正式默认代码字体为 Hack。

默认回退顺序为 Hack → Menlo → Monaco → Courier New → monospace。调试候选 Fira Code 与 JetBrains Mono 通过 `next/font/google` 自托管，JetBrains Mono 同时加载常规和斜体。后三款命名字体使用设备已有字体，未安装时按等宽字体栈回退；系统等宽选项由浏览器决定字体。

选择仅应用于 `.tc-prose .md-code code`，不改变正文、标题、行内代码、代码块语言标签或其他界面文字。使用独立的 `thread-chat:code-font` 浏览器存储键，和中文字体选择互不影响。加载与记忆逻辑由 `hooks/use-preview-font.ts` 共用。

## 动态 Google 字体试读

展开「添加 Google 字体」，粘贴 `fonts.google.com/specimen/…` 或 `fonts.google.com/noto/specimen/…` 链接，也可输入字体名称，选择英文正文、中文正文、标题、代码块后点击「加载并应用」。成功使用的字体全部保留，最近使用的排在前面；历史胶囊区域超过固定高度后独立滚动，可一键再次应用到当前选定位置。

动态字体通过固定的 Google Fonts CSS API 下载，不需要 API Key，也不向字体服务发送对话内容。先尝试常规／粗体及斜体组合，不支持时依次退回常规／粗体、默认样式；没有真实粗体或斜体时由浏览器匹配或合成。加载完成后才更新字体，失败保留之前的选择。

英文、中文正文分别限制字体的字符范围，避免一种字体同时覆盖两种语言；不包含中文字形的字体不能应用到中文正文。标题和代码块不限制语言范围。每个位置的选择与最近使用记录存放在 `thread-chat:google-fonts:v1`，刷新后自动恢复；「恢复预设」恢复对应位置的预设字体，选择已有中文／代码字体也会取消该位置的动态覆盖。

动态试读需要浏览器能访问 Google 字体服务；与构建时通过 `next/font` 自托管的预设字体不同。

- [Gelasio 字体信息](https://github.com/google/fonts/blob/main/ofl/gelasio/METADATA.pb)：设计者 Eben Sorkin，SIL OFL 1.1。
- [Google Fonts CSS API](https://developers.google.com/fonts/docs/css2)
