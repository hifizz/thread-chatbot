import { createAuthClient } from "better-auth/react"

// 浏览器端 auth 客户端。baseURL 留空时默认走当前站点同源 /api/auth。
export const authClient = createAuthClient()

export const { signIn, signUp, signOut, useSession } = authClient
