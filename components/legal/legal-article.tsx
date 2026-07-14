import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"
import { LEGAL } from "@/constants/legal"

// 法务页面统一排版：返回链接 + 标题 + 更新日期 + 模板提示 + 正文排版。
// 正文用普通语义标签（h2/p/ul/li），由此容器的子选择器统一上样式。
export function LegalArticle({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-svh w-full bg-background">
      <div className="mx-auto flex w-full max-w-2xl flex-col px-4 py-10">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> 返回
        </Link>

        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {LEGAL.appName} · 最后更新：{LEGAL.lastUpdated}
        </p>

        <div className="mt-4 rounded-lg border border-dashed border-border/60 p-3 text-xs leading-6 text-muted-foreground">
          本页为通用模板，仅供参考、不构成法律意见。上线前请将占位信息替换为真实主体信息，并交由法务/律师审阅。
        </div>

        <article className="mt-6 [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:mt-1.5 [&_li]:text-sm [&_li]:leading-7 [&_li]:text-muted-foreground [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:mt-3 [&_p]:text-sm [&_p]:leading-7 [&_p]:text-muted-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:ps-5">
          {children}
        </article>

        <div className="mt-10 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-4 text-sm">
          <Link
            href="/terms"
            className="text-muted-foreground hover:text-foreground"
          >
            服务条款
          </Link>
          <Link
            href="/privacy"
            className="text-muted-foreground hover:text-foreground"
          >
            隐私政策
          </Link>
          <Link
            href="/refund"
            className="text-muted-foreground hover:text-foreground"
          >
            退款政策
          </Link>
        </div>
      </div>
    </div>
  )
}
