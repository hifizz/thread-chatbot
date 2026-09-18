import type { Metadata } from "next"
import { SHARE_UI_COPY } from "@/constants/sharing"
import { getPublicShare } from "@/lib/thread-chat/application/sharing"
import { ShareShell } from "./share-shell"
import { ShareUnavailable } from "./share-unavailable"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "分享的只读快照",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

/**
 * 匿名只读分享页。token 即凭据：无效/过期/撤销统一渲染不可用页，
 * 不区分原因、不泄露标题或所有者；有效快照交给只读壳渲染。
 */
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const share = await getPublicShare(token)
  if (share === null) return <ShareUnavailable message={SHARE_UI_COPY.unavailable} />
  return <ShareShell snapshot={share.snapshot} />
}
