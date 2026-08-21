import assert from "node:assert/strict"
import test from "node:test"

import { evaluateConversationCutoverDrain } from "./conversation-drain.ts"

test("drain 仅在所有可能继续产生事实的队列清零后放行", () => {
  const ready = evaluateConversationCutoverDrain({
    legacyActiveGenerations: 0,
    legacyPendingBilling: 0,
    canonicalActiveGenerations: 0,
    canonicalPendingBilling: 0,
    canonicalPendingOutbox: 0,
  })
  assert.equal(ready.ready, true)
  assert.deepEqual(ready.blockers, [])

  const blocked = evaluateConversationCutoverDrain({
    legacyActiveGenerations: 2,
    legacyPendingBilling: 1,
    canonicalActiveGenerations: 0,
    canonicalPendingBilling: 3,
    canonicalPendingOutbox: 4,
  })
  assert.equal(blocked.ready, false)
  assert.deepEqual(
    blocked.blockers.map((entry) => entry.code),
    [
      "legacy_generation_active",
      "legacy_billing_pending",
      "canonical_billing_pending",
      "canonical_outbox_pending",
    ]
  )
})
