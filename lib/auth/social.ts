// 社交登录的服务端配置（仅读 env，无副作用、无重依赖）。
// 单一事实来源：betterAuth 服务端配置与「登录页是否显示 Google 按钮」都从这里取，
// 避免再引入 NEXT_PUBLIC 开关——只要同时配了 id 与 secret 即视为启用。
// 使用函数而非模块级常量，确保自托管时可在请求期读取 runtime-only 密钥。

export type GoogleAuthConfig = {
  clientId: string
  clientSecret: string
}

/** 返回完整的 Google OAuth 配置；缺少任一项时视为未启用。 */
export function getGoogleAuthConfig(): GoogleAuthConfig | undefined {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  return clientId && clientSecret ? { clientId, clientSecret } : undefined
}

/** 同时配齐 id 与 secret 才启用 Google 登录。 */
export function isGoogleAuthEnabled(): boolean {
  return getGoogleAuthConfig() !== undefined
}
