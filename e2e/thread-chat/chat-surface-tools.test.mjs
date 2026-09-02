import assert from "node:assert/strict"
import { surfaceTools } from "../../app/api/chat/surface-tools.ts"

assert.deepEqual(Object.keys(surfaceTools()).sort(), [
  "compareTable",
  "getWeather",
])

console.log("PASS  linear chat surface exposes its owned helper tools")
