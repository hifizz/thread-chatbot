// 落地页内容 + 内容类型的单一事实来源。组件只做布局，改文案不改结构
// （视觉/文案后续可独立细化，见 openspec: add-landing-retire-linear-chat）。

import { ROUTES } from "./routes"

/** 一个 CTA：文案 + 目标路由（默认应指向 ROUTES.flagship）。 */
export interface CtaContent {
  label: string
  href: string
}

export interface HeroContent {
  eyebrow?: string // 顶部小标签（可选）
  title: string // 主标题
  subtitle: string // 一句话价值主张
  primaryCta: CtaContent
}

export interface FeatureItem {
  icon?: string // lucide-react 图标名或 emoji，由渲染层解释
  title: string
  description: string
}

/** 划选开分支的静态示意（纯展示，不接真实模型）。 */
export interface BranchingDemoContent {
  title: string
  description: string
  sampleAnswer: string // 样例 assistant 回复
  anchorText: string // 其中被「划选」高亮的片段（必须是 sampleAnswer 的子串）
  branchQuestion: string // 由该片段岔出的子问题
}

export interface CanvasShowcaseContent {
  title: string
  description: string
  media?: string // 可选静态示意资源路径（后续补）
}

/** 落地页全部内容的聚合——组件从这里取。 */
export interface LandingContent {
  hero: HeroContent
  branchingDemo: BranchingDemoContent
  canvasShowcase: CanvasShowcaseContent
  features: FeatureItem[]
  closingCta: CtaContent
}

// 占位文案：结构已定，措辞待细化。anchorText 必须是 sampleAnswer 的子串。
export const LANDING: LandingContent = {
  hero: {
    eyebrow: "Thread Chat",
    title: "让对话像思路一样分叉",
    subtitle:
      "划选 AI 回复里的任意一句，就地岔出一条新对话。不再把追问挤进一根越拉越长的线里——每个想法都有自己的分支。",
    primaryCta: { label: "开始聊天", href: ROUTES.flagship },
  },
  branchingDemo: {
    title: "划选即开分支",
    description:
      "在 AI 的回答里选中你想深挖的片段，气泡当场弹出——带着上下文岔出一条子对话，主线原地保留一枚可回跳的脚注。",
    sampleAnswer:
      "要提升检索质量，可以从两方面入手：一是优化向量嵌入模型的选型，二是引入重排序（rerank）阶段对候选结果二次打分。",
    anchorText: "重排序（rerank）阶段对候选结果二次打分",
    branchQuestion: "rerank 具体怎么接？延迟会增加多少？",
  },
  canvasShowcase: {
    title: "整棵对话是一张画布",
    description:
      "所有分支在画布上铺开，一眼看清脉络。在节点里直接读最近消息、继续追问，多条线并行推进，不用来回切换。",
  },
  features: [
    {
      icon: "database",
      title: "持久化",
      description: "整棵分支树自动入库，刷新、换设备都在，接着上次继续。",
    },
    {
      icon: "sparkles",
      title: "多模型",
      description: "MiniMax、DeepSeek、OpenAI 等经统一网关随手切换，按需选型。",
    },
    {
      icon: "wallet",
      title: "按量计费",
      description: "按 token 实时计费、余额透明，用多少付多少，无订阅门槛。",
    },
  ],
  closingCta: { label: "开始聊天", href: ROUTES.flagship },
}
