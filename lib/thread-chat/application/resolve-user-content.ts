import type { ModelCatalog } from "@/lib/model-catalog/schema"
import { ARTIFACT_REFERENCE_COPY, ARTIFACT_REFERENCE_MAX_CHARS, ARTIFACT_REFERENCE_MAX_OCCURRENCES } from "@/constants/artifact-reference"
import type { ThreadQuoteDataV1 } from "../contracts/quote"
import { artifactReferenceData, artifactReferenceDataSchema } from "../contracts/artifact-reference"
import { filesFromMessageContent, messageContentInputSchema, messageContentToUiParts, type MessageContentInput } from "../contracts/message-content"
import type { ThreadChatUIMessage } from "../contracts/ui-message"
import { loadProjectReferenceArtifactRows } from "../persistence/artifact-repository"
import type { ConversationTransaction } from "../persistence/transaction"
import { assertModelSupportsNewAttachments, assertOwnedReadyAttachments } from "./command-utils"
import { notFound, stateConflict } from "./errors"
import { assertEditQuoteSemantics, assertValidQuoteSources } from "./quote-validation"

/** 在命令已有的所有权锁和事务内，将有序输入解析成权威持久化内容。 */
export async function resolveUserContent(input: {
  catalog: ModelCatalog
  tx: ConversationTransaction
  userId: string
  projectId: string
  modelId: string
  content: MessageContentInput
  operation:
    | { type: "create-project" }
    | { type: "send"; sourceThreadId: string; frozenFirstQuote?: ThreadQuoteDataV1 }
    | { type: "edit"; originalParts: ThreadChatUIMessage["parts"] }
}): Promise<ThreadChatUIMessage["parts"]> {
  // 解析内容对象而非整条命令，避免破坏 HTTP parts 格式。
  const content = messageContentInputSchema.parse({ parts: input.content.parts })
  const files = filesFromMessageContent(content)
  assertModelSupportsNewAttachments(input.catalog, input.modelId, files)
  await assertOwnedReadyAttachments(input.tx, input.userId, files)
  const operation = input.operation
  if (operation.type === "create-project") {
    if (content.parts.some((part) => part.type === "quote" || part.type === "artifact-reference"))
      stateConflict("新建 Project 时不能引用尚不属于该 Project 的内容")
  } else if (operation.type === "edit") {
    assertEditQuoteSemantics(operation.originalParts, content)
  } else {
    await assertValidQuoteSources({ tx: input.tx, projectId: input.projectId, sourceThreadId: operation.sourceThreadId, frozenFirstQuote: operation.frozenFirstQuote, content })
  }
  const ids = content.parts.flatMap((part) => part.type === "artifact-reference" ? [part.artifactId] : [])
  if (ids.length > ARTIFACT_REFERENCE_MAX_OCCURRENCES)
    stateConflict(`单条消息最多提及 ${ARTIFACT_REFERENCE_MAX_OCCURRENCES} 次 Artifact`)
  const rows = await loadProjectReferenceArtifactRows(input.tx, input.projectId, ids)
  if (rows.length !== new Set(ids).size) notFound()
  const retained = new Map(operation.type === "edit" ? operation.originalParts.flatMap((part) =>
    part.type === "data-artifact-reference" ? [[part.data.artifactId, artifactReferenceDataSchema.parse(part.data)] as const] : []
  ) : [])
  if (rows.some((row) => row.artifact.kind !== "markdown" || (!retained.has(row.artifact.id) && row.sourceMessageStatus !== "completed")))
    stateConflict(ARTIFACT_REFERENCE_COPY.incomplete)
  const chars = rows.reduce((sum, row) => sum + row.artifact.title.length + row.artifact.content.length, 0)
  if (chars > ARTIFACT_REFERENCE_MAX_CHARS) stateConflict(ARTIFACT_REFERENCE_COPY.budget)
  const resolved = new Map(rows.map(({ artifact }) => [artifact.id, artifactReferenceData(artifact)]))
  return messageContentToUiParts(content, (id) => retained.get(id) ?? resolved.get(id)!)
}
