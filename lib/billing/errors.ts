export type BillingAdmissionErrorCode =
  | "CREDIT_EXHAUSTED"
  | "RUN_RESERVATION_INSUFFICIENT"
  | "MODEL_PRICING_UNAVAILABLE"
  | "TOO_MANY_ACTIVE_RUNS"

export class BillingAdmissionError extends Error {
  constructor(
    readonly code: BillingAdmissionErrorCode,
    message: string
  ) {
    super(message)
    this.name = "BillingAdmissionError"
  }
}
