import { isFlyRuntime } from "@/lib/runtime/instance"

/**
 * 启动期环境白名单校验：缺配置明确失败，不静默降级成匿名供应商或零价。
 * 只校验「存在性/格式」，绝不把密钥值写进日志或返回给客户端。
 *
 * 分层：
 * - required：任何生产运行时都必须有；
 * - flyRequired：仅在 Fly 运行时追加（多实例正确性依赖，如 Server Actions 加密键）；
 * - optional：缺失只警告（可观测性、邮件、支付等可降级能力）。
 */

type EnvRequirement = {
  name: string
  validate?: (value: string) => boolean
}

const REQUIRED: EnvRequirement[] = [
  { name: "DATABASE_URL" },
  { name: "BETTER_AUTH_SECRET", validate: (v) => v.length >= 32 },
  { name: "TOKEN_ROUTER_BASE_URL" },
  { name: "TOKEN_ROUTER_API_KEY" },
]

const FLY_REQUIRED: EnvRequirement[] = [
  // Next.js 多实例：所有实例必须用同一把 Server Functions 加密键，
  // 否则跨实例调用报 "Failed to find Server Action"。
  {
    name: "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
    validate: (v) => {
      try {
        const bytes = Buffer.from(v, "base64")
        return [16, 24, 32].includes(bytes.length)
      } catch {
        return false
      }
    },
  },
  // 内部机器端点（drain/reconcile）的 Bearer 凭证。
  { name: "CRON_SECRET", validate: (v) => v.length >= 16 },
]

const OPTIONAL: EnvRequirement[] = [
  { name: "DIRECT_URL" },
  { name: "R2_ACCOUNT_ID" },
  { name: "R2_ACCESS_KEY_ID" },
  { name: "R2_SECRET_ACCESS_KEY" },
  { name: "R2_BUCKET" },
  { name: "RESEND_API_KEY" },
  { name: "AXIOM_TOKEN" },
  { name: "LANGFUSE_PUBLIC_KEY" },
]

export type RuntimeEnvReport = {
  ok: boolean
  fly: boolean
  missing: string[]
  invalid: string[]
  warnings: string[]
}

export function checkRuntimeEnv(
  source: Record<string, string | undefined> = process.env
): RuntimeEnvReport {
  const fly = Boolean(source.FLY_APP_NAME && source.FLY_MACHINE_ID)
  const missing: string[] = []
  const invalid: string[] = []
  const warnings: string[] = []

  for (const req of [...REQUIRED, ...(fly ? FLY_REQUIRED : [])]) {
    const value = source[req.name]
    if (!value) {
      missing.push(req.name)
      continue
    }
    if (req.validate && !req.validate(value)) invalid.push(req.name)
  }

  // R2 四个值要么全配要么全不配，半配会让附件路径在运行时才炸。
  const r2 = OPTIONAL.filter((r) => r.name.startsWith("R2_"))
  const r2Set = r2.filter((r) => source[r.name]).length
  if (r2Set > 0 && r2Set < r2.length) {
    warnings.push("R2 配置不完整：附件上传将不可用")
  }
  for (const req of OPTIONAL) {
    if (!req.name.startsWith("R2_") && !source[req.name]) {
      warnings.push(`${req.name} 未配置，相关能力降级`)
    }
  }

  return { ok: missing.length === 0 && invalid.length === 0, fly, missing, invalid, warnings }
}

/**
 * 生产环境缺关键配置抛错阻断启动；只在 Fly 运行时硬失败，
 * 其他宿主（Vercel/本地/CI）降级为告警，避免破坏未按本白名单配置的既有部署。
 */
export function assertRuntimeEnv(
  source: Record<string, string | undefined> = process.env
): RuntimeEnvReport {
  const report = checkRuntimeEnv(source)
  for (const warning of report.warnings) {
    console.warn(`[runtime.env] ${warning}`)
  }
  if (!report.ok) {
    const detail = [
      report.missing.length > 0 ? `缺少: ${report.missing.join(", ")}` : "",
      report.invalid.length > 0 ? `格式不合法: ${report.invalid.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("；")
    const message = `[runtime.env] 运行环境校验失败 — ${detail}`
    if (source.NODE_ENV === "production" && report.fly) {
      throw new Error(message)
    }
    console.warn(message)
  }
  return report
}

export { isFlyRuntime }
