import { randomUUID } from "node:crypto"

/**
 * 当前进程在多实例部署中的身份。
 * Fly 注入 FLY_MACHINE_ID/FLY_IMAGE_REF/FLY_APP_NAME；其他环境退化为进程级随机 ID，
 * 只用于「这条生成归谁跑」的 lease，不用于路由。
 */

const INSTANCE_ID_SYMBOL = Symbol.for("thread-chat.runtime.instance-id")
type InstanceGlobal = typeof globalThis & {
  [INSTANCE_ID_SYMBOL]?: string
}

export function getInstanceId(): string {
  const scope = globalThis as InstanceGlobal
  if (!scope[INSTANCE_ID_SYMBOL]) {
    scope[INSTANCE_ID_SYMBOL] =
      process.env.FLY_MACHINE_ID ?? `proc-${randomUUID()}`
  }
  return scope[INSTANCE_ID_SYMBOL]
}

export function getReleaseId(): string {
  return (
    process.env.FLY_IMAGE_REF ??
    process.env.AI_OBSERVABILITY_RELEASE ??
    process.env.GIT_COMMIT_SHA ??
    "dev"
  )
}

/** 只有 Fly 注入的 machine id 才能作为 fly-replay/fly-force-instance-id 目标。 */
export function isFlyRuntime(): boolean {
  return Boolean(process.env.FLY_APP_NAME && process.env.FLY_MACHINE_ID)
}
