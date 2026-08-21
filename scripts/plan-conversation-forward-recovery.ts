import { readFile } from "node:fs/promises"

import {
  conversationRecoveryRequestSchema,
  planConversationRecovery,
} from "../lib/thread-chat/cutover/conversation-forward-recovery.ts"

const requestFlag = process.argv.indexOf("--request-file")
const requestPath = requestFlag >= 0 ? process.argv[requestFlag + 1] : undefined
if (!requestPath || requestPath.startsWith("--"))
  throw new Error("必须提供 --request-file；规划器不会从环境猜测恢复意图")

const request = conversationRecoveryRequestSchema.parse(
  JSON.parse(await readFile(requestPath, "utf8"))
)
const plan = planConversationRecovery(request)

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      mode: "read-only-plan",
      environment: request.environment,
      incidentId: request.incidentId,
      cutoverEpoch: request.cutoverEpoch,
      firstCanonicalWriteAt: request.firstCanonicalWriteAt,
      plan,
    },
    null,
    2
  )
)
