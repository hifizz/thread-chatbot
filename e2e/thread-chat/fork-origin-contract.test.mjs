import assert from "node:assert/strict"
import { forkThreadCommandSchema } from "../../lib/thread-chat/contracts/commands.ts"
import { buildBranchOriginQuote } from "../../lib/thread-chat/application/quote-resolver.ts"
import { buildUserParts } from "../../lib/thread-chat/application/command-utils.ts"
import { threadQuotePartToModelText } from "../../lib/thread-chat/application/quote-model.ts"

const id = () => crypto.randomUUID()
const anchor = {
  quote: {
    exact: "共同历史应先于分支引用",
    prefix: "缓存优化：",
    suffix: "。",
  },
  position: { start: 5, end: 16 },
}
const command = {
  commandId: id(),
  threadId: id(),
  sourceMessageId: id(),
  anchorText: anchor.quote.exact,
  anchor,
  modelId: "test/model",
  firstTurn: {
    userMessageId: id(),
    assistantMessageId: id(),
    text: "为什么？",
    files: [],
  },
}
assert.deepEqual(forkThreadCommandSchema.parse(command).firstTurn, command.firstTurn)
assert.throws(
  () =>
    forkThreadCommandSchema.parse({
      ...command,
      firstTurn: {
        ...command.firstTurn,
        additionalQuotes: [
          {
            source: {
              type: "message-selection",
              sourceMessageId: id(),
              anchor,
            },
            comment: "非法夹带",
          },
        ],
      },
    }),
  /unrecognized|Unrecognized|additionalQuotes/i,
  "Fork firstTurn must not carry arbitrary cross-thread quote selections"
)

const origin = buildBranchOriginQuote({
  projectId: id(),
  parentThreadId: id(),
  sourceMessageId: command.sourceMessageId,
  anchor,
  anchorText: command.anchorText,
  quoteId: id(),
})
const parts = buildUserParts({
  text: command.firstTurn.text,
  files: [],
  quotes: [origin],
})
assert.deepEqual(parts.map((part) => part.type), ["data-quote", "text"])
assert.match(threadQuotePartToModelText(parts[0].data), /共同历史应先于分支引用/)
assert.doesNotMatch(
  threadQuotePartToModelText(parts[0].data),
  new RegExp(origin.source.threadId),
  "source metadata must never enter the model prompt"
)

console.log("PASS fork first turn is server-derived origin only")
