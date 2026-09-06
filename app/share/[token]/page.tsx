import type { Metadata } from "next"
import { readPublicShare } from "@/lib/thread-chat/application/sharing"
import { SHARE_UNAVAILABLE } from "@/constants/sharing"
import { ShareReader } from "../share-reader"
import "@/app/thread-chat/thread-chat.css"
import "../sharing.css"

export const dynamic = "force-dynamic"
// 元信息恒定，不输出标题/正文；内容入口独立进行生命周期校验。
export const metadata: Metadata = { title: "只读分享 · Thread Chat", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" }

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  let share
  try { share = await readPublicShare((await params).token) } catch { share = null }
  if (!share) return <main className="tc share-unavailable"><h1>分享不可用</h1><p>{SHARE_UNAVAILABLE}</p></main>
  return <ShareReader snapshot={share.snapshot} createdAt={share.createdAt} expiresAt={share.expiresAt} />
}
