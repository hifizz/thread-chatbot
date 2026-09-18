export type ConsentDecision = "accepted" | "rejected"

export type ConsentSnapshot = {
  policyVersion: string
  necessary: true
  analytics: boolean
  decision: ConsentDecision
  decidedAt: string
  expiresAt: string
  revision: number
}

export type ConsentState =
  | { state: "unresolved"; analytics: false }
  | { state: "valid"; snapshot: ConsentSnapshot }
  | { state: "expired"; analytics: false }

export type ConsentCookiePayload = ConsentSnapshot & {
  deviceId: string
}

export type DataPurpose =
  | "service"
  | "billing"
  | "security"
  | "analytics"
  | "evaluation"

export type DataRequestKind = "export" | "delete"
export type DataRequestStatus =
  | "requested"
  | "verified"
  | "processing"
  | "completed"
  | "rejected"

export type PrivacyConsentResponse = {
  consent: ConsentState
}

export type PrivacyErrorResponse = {
  code:
    | "AUTH_REQUIRED"
    | "INVALID_ORIGIN"
    | "VALIDATION_ERROR"
    | "PRIVACY_PERSISTENCE_FAILED"
}

