import { after } from "next/server"
import { randomUUID } from "node:crypto"
import {
  DEFAULT_THREAD_CHAT_MODEL_ID,
  isThreadChatModelId,
} from "@/constants/model"
import { dbClient } from "@/lib/db"
import { MessageRunner } from "../../application/message-runner"
import { ThreadChatCommands } from "../../application/thread-chat-commands"
import { ThreadChatQueries } from "../../application/thread-chat-queries"
import { AiSdkRuntime } from "../../infrastructure/ai-sdk-runtime"
import {
  IsolatedTestAiRuntime,
  usesIsolatedTestAiRuntime,
} from "../../infrastructure/isolated-test-ai-runtime"
import { ThreadChatUnitOfWork } from "../../infrastructure/repositories"
import { ThreadChatApiError } from "./errors"

const unitOfWork = new ThreadChatUnitOfWork(dbClient)
const aiRuntime = usesIsolatedTestAiRuntime({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
})
  ? new IsolatedTestAiRuntime()
  : new AiSdkRuntime()
const runner = new MessageRunner(dbClient, unitOfWork, aiRuntime, {
  generateId: randomUUID,
  now: () => new Date(),
})

export const threadChatServer = {
  queries: new ThreadChatQueries(dbClient),
  runner,
  commands() {
    return new ThreadChatCommands(unitOfWork, {
      generateId: randomUUID,
      now: () => new Date(),
      resolveModelId(requestedModelId) {
        if (requestedModelId === undefined) return DEFAULT_THREAD_CHAT_MODEL_ID
        if (isThreadChatModelId(requestedModelId)) return requestedModelId
        throw new ThreadChatApiError(
          "model_not_available",
          422,
          "Requested model is not available for ThreadChat."
        )
      },
      wakeRunAfterCommit(messageRunId) {
        after(() => runner.execute(messageRunId))
      },
      onWakeError(error) {
        console.error("[thread-chat-api] run wake failed", error)
      },
    })
  },
}
