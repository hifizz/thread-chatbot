interface DocumentSourceMessage {
  role: string
  status: string
}

/** 首次登记只接受成功回复；已经提交的版本不随来源终态撤销。 */
export function canRegisterDocument(message: DocumentSourceMessage | null | undefined): boolean {
  return message?.role === "assistant" && message.status === "completed"
}

export function isActiveDocumentExecution(message: (DocumentSourceMessage & {
  stopRequestedAt: Date | null
  supersededAt: Date | null
}) | null | undefined): boolean {
  return message?.role === "assistant" && message.status === "generating"
    && !message.stopRequestedAt && !message.supersededAt
}
