import { AI_DIAGNOSTIC_EVENTS } from "@/constants/observability"
import {
  buildProductEvent,
  validateProductEvent,
  type ProductEvent,
  type ProductEventName,
  type ProductEventPayloads,
} from "@/lib/analytics/events"
import {
  buildCaptureBody,
  deliverPosthogCapture,
  resolvePosthogConfig,
  type PosthogConfig,
  type PosthogDeliveryResult,
} from "@/lib/analytics/posthog"
import { logDiagnostic } from "@/lib/observability/diagnostic-log"
import { resolveObservabilityConfig } from "@/lib/observability/config"
import { pseudonymizeUserId } from "@/lib/observability/identity"
import { hasAccountAnalyticsConsent } from "@/lib/privacy/consent-store"

export type ProductEventEmitInput<K extends ProductEventName> = {
  name: K
  /** 产生事件的事实记录 ID（Generation/Message/Thread/Revision 等）。 */
  factId: string
  factVersion?: number | string
  occurredAt?: Date
  userId: string
  payload: ProductEventPayloads[K]
}

export type ProductEventEmitResult =
  | { status: "delivered"; eventId: string }
  | {
      status: "skipped"
      reason: "invalid" | "no-consent" | "not-configured" | "no-identity"
      eventId: string | null
    }
  | { status: "failed"; eventId: string | null; errorCategory: string }

type EmitDependencies = {
  posthogConfig?: PosthogConfig | null
  hasConsent?: (userId: string) => Promise<boolean>
  deliver?: (
    event: ProductEvent,
    distinctId: string,
    config: PosthogConfig | null
  ) => Promise<PosthogDeliveryResult>
}

let warnedMissingSalt = false

function analyticsDistinctId(
  userId: string,
  salt: string | undefined
): string | null {
  if (!salt) {
    if (!warnedMissingSalt) {
      warnedMissingSalt = true
      console.warn(
        "[analytics] AI_OBSERVABILITY_ID_SALT 未配置，跳过产品事件 distinct_id"
      )
    }
    return null
  }
  return pseudonymizeUserId(userId, salt)
}

/**
 * 服务端事实事件的唯一发送入口：只允许真实状态提交后调用。
 * 投递前重新检查账户当前授权；未授权、撤回或不可识别身份一律丢弃且不补传。
 * 发送失败只记诊断日志，绝不向聊天/账务链路抛错。
 */
export async function emitProductEvent<K extends ProductEventName>(
  input: ProductEventEmitInput<K>,
  dependencies: EmitDependencies = {}
): Promise<ProductEventEmitResult> {
  try {
    const config = resolveObservabilityConfig()
    const posthogConfig =
      dependencies.posthogConfig !== undefined
        ? dependencies.posthogConfig
        : resolvePosthogConfig()
    const event = buildProductEvent({
      name: input.name,
      factId: input.factId,
      ...(input.factVersion !== undefined
        ? { factVersion: input.factVersion }
        : {}),
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      userId: input.userId,
      release: config.release,
      environment: config.environment,
      payload: input.payload,
    })
    if (!validateProductEvent(event))
      return { status: "skipped", reason: "invalid", eventId: null }

    const hasConsent =
      dependencies.hasConsent ?? hasAccountAnalyticsConsent
    if (!(await hasConsent(input.userId))) {
      return {
        status: "skipped",
        reason: "no-consent",
        eventId: event.id,
      }
    }

    const distinctId = analyticsDistinctId(input.userId, config.idSalt)
    if (!distinctId)
      return { status: "skipped", reason: "no-identity", eventId: event.id }

    const deliver =
      dependencies.deliver ??
      ((productEvent: ProductEvent, id: string, cfg: PosthogConfig | null) =>
        deliverPosthogCapture(
          buildCaptureBody({
            config: cfg ?? { apiKey: "", host: "" },
            eventId: productEvent.id,
            name: productEvent.name,
            distinctId: id,
            occurredAt: productEvent.occurredAt,
            properties: {
              schema_version: productEvent.schemaVersion,
              environment: productEvent.environment,
              release: productEvent.release,
              ...(productEvent.payload as Record<
                string,
                string | number | boolean | null
              >),
            },
          }),
          cfg
        ))
    const result = await deliver(event, distinctId, posthogConfig)
    if (result.status === "delivered")
      return { status: "delivered", eventId: event.id }
    if (result.status === "skipped")
      return { status: "skipped", reason: "not-configured", eventId: event.id }
    logDiagnostic(
      AI_DIAGNOSTIC_EVENTS.analyticsDeliveryFailed,
      {
        eventName: event.name,
        eventId: event.id,
        errorCategory: result.errorCategory,
      },
      undefined,
      "warn"
    )
    return {
      status: "failed",
      eventId: event.id,
      errorCategory: result.errorCategory,
    }
  } catch (error) {
    logDiagnostic(
      AI_DIAGNOSTIC_EVENTS.analyticsDeliveryFailed,
      { eventName: input.name },
      error,
      "warn"
    )
    return {
      status: "failed",
      eventId: null,
      errorCategory: "unknown",
    }
  }
}

/** fire-and-forget：post-commit 发射，不阻塞响应。 */
export function emitProductEventDetached<K extends ProductEventName>(
  input: ProductEventEmitInput<K>
): void {
  void emitProductEvent(input).catch(() => undefined)
}
