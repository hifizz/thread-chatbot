// 法务页面的可替换占位信息（单一事实来源）。
// ⚠️ 上线前请把占位符替换为真实主体信息，并交由法务/律师审阅。以下文案为通用模板，不构成法律意见。

export const LEGAL = {
  /** 产品/站点名称 */
  appName: "Thread Chat",
  /** 运营主体（公司/个人）全称 */
  entity: "[运营主体全称]",
  /** 站点域名 */
  domain: "[yourdomain.com]",
  /** 联系/客服邮箱 */
  contactEmail: "[support@yourdomain.com]",
  /** 争议适用法律与管辖地 */
  jurisdiction: "[中华人民共和国 / 你的管辖地]",
  /** 生效 / 最后更新日期（请手动维护） */
  lastUpdated: "[2026-07-14]",
  /** 未使用额度可申请退款的天数 */
  refundWindowDays: 14,
} as const

// 涉及的第三方服务（隐私政策里如实披露；按实际启用情况增删）。
export const THIRD_PARTIES: { name: string; purpose: string }[] = [
  { name: "Supabase", purpose: "数据库托管（账户、对话、计费数据）" },
  { name: "Resend", purpose: "发送验证 / 找回密码等事务邮件" },
  { name: "Creem", purpose: "支付与充值处理（Merchant of Record）" },
  { name: "Cloudflare", purpose: "人机验证（Turnstile）与 AI 网关" },
  { name: "Vercel", purpose: "应用托管与 AI 网关" },
  {
    name: "大模型供应商（MiniMax / DeepSeek / OpenAI 等）",
    purpose: "处理你的对话内容以生成回复",
  },
  { name: "Cloudflare R2", purpose: "存储你上传的附件（如启用）" },
]
