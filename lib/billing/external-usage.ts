import { createHash } from "node:crypto"

export type ExternalUsageSummary = {
  callCount: number
  billableUnits: number
  costMicros: number
  priceMicros: number
}

export type ExternalUsageCharge = {
  callIndex: number
  billableUnits: number
  costMicros: number
  priceMicros: number
}

export const EMPTY_EXTERNAL_USAGE: ExternalUsageSummary = {
  callCount: 0,
  billableUnits: 0,
  costMicros: 0,
  priceMicros: 0,
}

/** 生成不含明文 query 的稳定 SHA-256 指纹。 */
export function fingerprintExternalQuery(query: string): string {
  return createHash("sha256")
    .update(query.trim().normalize("NFKC"), "utf8")
    .digest("hex")
}

/** provider + requestId + callIndex 的稳定幂等键。 */
export function externalUsageIdempotencyKey(
  provider: string,
  requestId: string,
  callIndex: number
): string {
  return createHash("sha256")
    .update(`${provider}\0${requestId}\0${callIndex}`, "utf8")
    .digest("hex")
}

/**
 * 单请求内的外部费用累加器。按 callIndex 去重，因此流完成、断连消费或回调重放不会
 * 把同一次 provider 调用重复计入 assistant metadata。
 */
export function createExternalUsageAccumulator(): {
  record: (charge: ExternalUsageCharge) => void
  snapshot: () => ExternalUsageSummary
} {
  const charges = new Map<number, ExternalUsageCharge>()

  return {
    record(charge) {
      if (!Number.isSafeInteger(charge.callIndex) || charge.callIndex < 0) {
        throw new Error("callIndex 必须是非负安全整数")
      }
      if (!charges.has(charge.callIndex)) charges.set(charge.callIndex, charge)
    },
    snapshot() {
      let billableUnits = 0
      let costMicros = 0
      let priceMicros = 0
      for (const charge of charges.values()) {
        billableUnits += charge.billableUnits
        costMicros += charge.costMicros
        priceMicros += charge.priceMicros
      }
      return {
        callCount: charges.size,
        billableUnits,
        costMicros,
        priceMicros,
      }
    },
  }
}
