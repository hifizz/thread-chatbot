export const CANONICAL_CONVERSATION_SCHEMA_VERSION = 1 as const

export type ConversationAuthority = "legacy" | "canonical"
export type ConversationMaintenanceMode = "off" | "read-only"

export interface ConversationAuthorityState {
  readonly authority: ConversationAuthority
  readonly schemaVersion: typeof CANONICAL_CONVERSATION_SCHEMA_VERSION
  readonly epoch: string
  readonly maintenanceMode: ConversationMaintenanceMode
  /** 仅本地/测试允许放宽生产保护；它不是第三种 authority。 */
  readonly isolatedTest: boolean
}

type AuthorityEnvironment = Readonly<Record<string, string | undefined>>

const RETIRED_AUTHORITY_VARIABLES = [
  "CONVERSATION_COMMAND_API_AUTHORITY",
  "CONVERSATION_GENERATION_AUTHORITY",
  "CONVERSATION_CLIENT_AUTHORITY",
  "BRANCH_TREE_AUTHORITY_ENABLED",
  "BRANCH_GENERATION_AUTHORITY_ENABLED",
  "CONVERSATION_PERSISTENCE_WRITE_MODE",
  "THREAD_TREE_LEGACY_WRITES_ENABLED",
] as const

/** 单一部署事实：客户端、命令、Generation 和 legacy 写权限必须来自同一个值。 */
export function resolveConversationAuthority(
  environment: AuthorityEnvironment = process.env
): ConversationAuthorityState {
  const retired = RETIRED_AUTHORITY_VARIABLES.filter(
    (name) => environment[name] !== undefined
  )
  if (retired.length > 0)
    throw new Error(`已退役的 authority 配置仍存在：${retired.join(", ")}`)

  const value = environment.CONVERSATION_AUTHORITY?.trim()
  if (value !== "legacy" && value !== "canonical")
    throw new Error("CONVERSATION_AUTHORITY 必须显式设置为 legacy 或 canonical")

  const maintenance = environment.CONVERSATION_MAINTENANCE_MODE?.trim()
  if (maintenance && maintenance !== "off" && maintenance !== "read-only")
    throw new Error("CONVERSATION_MAINTENANCE_MODE 必须是 off 或 read-only")

  const isolatedTest =
    environment.CONVERSATION_ISOLATED_TEST === "true" &&
    environment.NODE_ENV !== "production"
  if (
    environment.CONVERSATION_ISOLATED_TEST === "true" &&
    environment.NODE_ENV === "production"
  )
    throw new Error("生产环境不能启用 CONVERSATION_ISOLATED_TEST")

  const epoch = environment.CONVERSATION_CUTOVER_EPOCH?.trim()
  if (value === "canonical" && !epoch)
    throw new Error("canonical authority 必须设置 CONVERSATION_CUTOVER_EPOCH")

  return {
    authority: value,
    schemaVersion: CANONICAL_CONVERSATION_SCHEMA_VERSION,
    epoch: epoch || "legacy-pre-cutover",
    maintenanceMode: maintenance === "read-only" ? "read-only" : "off",
    isolatedTest,
  }
}

export function legacyProtocolRetiredResponse(input: {
  readonly protocol: string
  readonly epoch: string
}): Response {
  console.warn("[conversation-cutover] legacy_protocol_retired", input)
  return Response.json(
    {
      error: {
        code: "legacy_protocol_retired",
        message: "ThreadTree 协议已退役，请刷新并使用规范 Conversation 客户端",
      },
    },
    { status: 410 }
  )
}

export function conversationMaintenanceResponse(): Response {
  return Response.json(
    {
      error: {
        code: "conversation_maintenance",
        message: "Conversation 正处于受控维护窗口，请稍后重试",
      },
    },
    { status: 503, headers: { "Retry-After": "30" } }
  )
}

/** 认证与 ID 形状检查之后调用，避免 retired 响应成为资源探测旁路。 */
export function legacyProtocolGate(
  input: {
    readonly mutation: boolean
    readonly protocol?: string
  },
  environment: AuthorityEnvironment = process.env
): Response | null {
  const state = resolveConversationAuthority(environment)
  if (state.authority === "canonical")
    return legacyProtocolRetiredResponse({
      protocol: input.protocol ?? "unknown",
      epoch: state.epoch,
    })
  if (input.mutation && state.maintenanceMode === "read-only")
    return conversationMaintenanceResponse()
  return null
}
