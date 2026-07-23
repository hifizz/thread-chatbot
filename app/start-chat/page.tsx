import { randomUUID } from "node:crypto"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { ROUTES, signInWithRedirect, threadTreeRoute } from "@/constants/routes"
import { getSession } from "@/lib/auth/server"

// A fresh tree ID must be generated for every request, never at build time.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Starting a new chat · Thread Chat",
  robots: {
    index: false,
    follow: false,
  },
}

/** Authenticated entry that always opens a new branch-conversation tree. */
export default async function StartChatPage(): Promise<never> {
  const session = await getSession()
  if (!session) {
    redirect(signInWithRedirect(ROUTES.startChat))
  }
  redirect(threadTreeRoute(randomUUID()))
}
