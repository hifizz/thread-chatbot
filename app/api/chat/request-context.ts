import type { UIMessage } from "ai"
import type { ToolJSONSchema } from "assistant-stream"
import { getCurrentUserId } from "@/lib/auth/server"
import {
  DEFAULT_MODEL_ID,
  getChatModel,
  isLinearChatModelId,
  isUnbilledPreviewModel,
} from "@/constants/model"
import { isModelConfigured } from "@/lib/ai/provider"
import { hasPositiveBalance } from "@/lib/billing/credits"

type ChatRequestBody = {
  messages: UIMessage[]
  tools?: Record<string, ToolJSONSchema>
  deepResearch?: boolean
  /** thread-chat 分支对话页的持久化 generation identity。 */
  threadChat?: unknown
  modelId?: unknown
  id?: string
}

type ChatRequestContextDependencies = {
  currentUserId: typeof getCurrentUserId
  getModel: typeof getChatModel
  linearModelAllowed: typeof isLinearChatModelId
  modelConfigured: typeof isModelConfigured
  unbilledPreview: typeof isUnbilledPreviewModel
  positiveBalance: typeof hasPositiveBalance
}

const defaultDependencies: ChatRequestContextDependencies = {
  currentUserId: getCurrentUserId,
  getModel: getChatModel,
  linearModelAllowed: isLinearChatModelId,
  modelConfigured: isModelConfigured,
  unbilledPreview: isUnbilledPreviewModel,
  positiveBalance: hasPositiveBalance,
}

/** 鉴权、解析并完成模型/余额门禁，返回可直接进入生成编排的请求上下文。 */
export async function prepareChatRequestContext(
  req: Request,
  dependencies: ChatRequestContextDependencies = defaultDependencies
) {
  const userId = await dependencies.currentUserId()
  if (!userId) {
    return {
      kind: "response" as const,
      response: Response.json(
        { error: "请先登录后再使用对话功能。" },
        { status: 401 }
      ),
    }
  }

  const body = (await req.json()) as ChatRequestBody
  const rawModelId = body.modelId
  if (
    rawModelId !== undefined &&
    (typeof rawModelId !== "string" || !dependencies.getModel(rawModelId))
  ) {
    return {
      kind: "response" as const,
      response: Response.json({ error: "未知或无效的模型。" }, { status: 400 }),
    }
  }

  const modelId = typeof rawModelId === "string" ? rawModelId : DEFAULT_MODEL_ID
  const model = dependencies.getModel(modelId)!
  if (body.threadChat == null && !dependencies.linearModelAllowed(modelId)) {
    return {
      kind: "response" as const,
      response: Response.json(
        { error: "该模型不支持线性对话，请选择可用模型后重试。" },
        { status: 400 }
      ),
    }
  }
  if (!dependencies.modelConfigured(model)) {
    return {
      kind: "response" as const,
      response: Response.json(
        {
          error: `模型「${model.name}」未配置，请联系管理员在服务端配置对应 API Key 或可用网关。`,
        },
        { status: 400 }
      ),
    }
  }

  const isUnbilledPreview = dependencies.unbilledPreview(model)
  if (!isUnbilledPreview && !(await dependencies.positiveBalance(userId))) {
    return {
      kind: "response" as const,
      response: Response.json(
        { error: "额度不足，请充值后再试。" },
        { status: 402 }
      ),
    }
  }

  return {
    kind: "ready" as const,
    userId,
    messages: body.messages,
    tools: body.tools,
    deepResearch: body.deepResearch,
    threadChat: body.threadChat,
    linearThreadId: body.id,
    modelId,
    model,
    isUnbilledPreview,
  }
}
