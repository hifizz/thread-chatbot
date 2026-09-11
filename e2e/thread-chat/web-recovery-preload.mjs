// 仅供本地验收：NODE_OPTIONS=--import=... 注入；不在产品代码中开放故障开关。
import { readFileSync, appendFileSync } from "node:fs"
const control = process.env.WEB_RECOVERY_CONTROL
if (control && process.env.NODE_ENV !== "production") {
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!/^https:\/\/(?:api\.anysearch\.com|api\.exa\.ai)\//.test(url)) return original(input, init)
    const config = JSON.parse(readFileSync(control, "utf8"))
    const request = typeof init?.body === "string" ? JSON.parse(init.body) : {}
    const target = request.params?.arguments?.url ?? request.urls?.[0]
    let response
    if (config.mode === "empty") {
      response = Response.json(target ? { result: { isError: true, content: [{ type: "text", text: "Controlled upstream failure" }] } } : { results: [] })
    } else if (config.mode === "recover" && target?.includes("introducing-the-agents-api")) {
      response = Response.json({ result: { isError: true, content: [{ type: "text", text: "Controlled extraction failure" }] } })
    } else {
      response = await original(input, init)
    }
    appendFileSync(config.log, JSON.stringify({ at: new Date().toISOString(), mode: config.mode, providerUrl: url, request, status: response.status, response: await response.clone().text() }) + "\n", { mode: 0o600 })
    return response
  }
}
