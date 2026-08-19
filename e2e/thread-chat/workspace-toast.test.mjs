import assert from "node:assert/strict"
import { workspaceToastDuration } from "../../app/thread-chat/orchestration/workspace-toast-logic.ts"

assert.equal(workspaceToastDuration({ message: "saved" }), 2600)
assert.equal(workspaceToastDuration({ message: "replaced", undo() {} }), 5200)

console.log("PASS  workspace toast keeps normal and undo visibility windows")
