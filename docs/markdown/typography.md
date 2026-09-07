# Markdown 字体选择记录

记录日期：2026-09-07。

## 当前选择

- 英文标题（h1–h6）：Brawler，加载 400、700 字重。
- 英文正文与表格：Lora，加载 500、600、700 字重及对应斜体。正文 CSS 仍为 400，匹配到 Lora 500，让英文更厚实，同时保持中文原有字重。
- 中文：继续使用原有系统字体回退。
- 表格默认字号：16px；紧凑模式保留 12px。
- 行内代码与代码块：继续使用等宽字体。

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
