import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { ROUTES, signInWithRedirect } from "@/constants/routes"
import { getSession } from "@/lib/auth/server"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Starting a new chat · Thread Chat",
  robots: {
    index: false,
    follow: false,
  },
}

/** 认证入口交给 canonical bootstrap 打开最近 Conversation 或建立首个 Conversation。 */
export default async function StartChatPage(): Promise<never> {
  const session = await getSession()
  if (!session) {
    redirect(signInWithRedirect(ROUTES.startChat))
  }
  redirect(ROUTES.flagship)
}
