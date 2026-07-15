// 社交登录的服务端配置（仅读 env，无副作用、无重依赖）。
// 单一事实来源：betterAuth 服务端配置与「登录页是否显示 Google 按钮」都从这里取，
// 避免再引入 NEXT_PUBLIC 开关——只要同时配了 id 与 secret 即视为启用。
// 客户端读不到这些密钥（非 NEXT_PUBLIC），故由服务端页面把 googleAuthEnabled 作为 prop 下传。

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

/** 同时配齐 id 与 secret 才启用 Google 登录。 */
export const googleAuthEnabled = Boolean(
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
)
