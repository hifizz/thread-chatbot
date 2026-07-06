import { auth } from "@/lib/auth"
import { toNextJsHandler } from "better-auth/next-js"

// better-auth 的全部端点（注册/登录/登出/会话等）统一挂到 /api/auth/*
export const { POST, GET } = toNextJsHandler(auth)
