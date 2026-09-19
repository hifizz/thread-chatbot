#!/usr/bin/env node
// 部署前排空：对 app 下每台 Machine 定向 POST /api/internal/drain，
// 等所有实例在途 Generation 归零（或超时）后退出，供 `fly deploy` 前调用。
//
// 用法：
//   FLY_API_TOKEN=... CRON_SECRET=... node scripts/fly-drain.mjs \
//     --app thread-chat --wait 120000 [--abort]
//
// - --app       Fly app 名（staging/production 各自执行）
// - --wait      每台实例同步等待排空的上限（ms），默认 120s；超时仍以 0 退出并打印警告，
//               由调用方决定是否继续部署（继续部署时旧机器按 SIGTERM 有界收尾兜底）
// - --abort     同时中止在途 Generation（正常发布不用；仅紧急替换时使用）
//
// 退出码：0=已排空或超时（见输出）；2=参数/凭证缺失或 API 错误。
// 定向语义：drain 端点是进程内状态，必须逐台 Machine 调用（fly-force-instance-id）。

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i]
  if (key === "--abort") {
    args.set("abort", true)
  } else if (key.startsWith("--")) {
    args.set(key.slice(2), process.argv[++i])
  }
}

const app = args.get("app") ?? process.env.FLY_APP_NAME
const waitMs = Number(args.get("wait") ?? 120_000)
const abort = args.get("abort") === true
const token = process.env.FLY_API_TOKEN
const cronSecret = process.env.CRON_SECRET

if (!app || !token || !cronSecret || !Number.isFinite(waitMs)) {
  console.error(
    "用法: FLY_API_TOKEN=... CRON_SECRET=... node scripts/fly-drain.mjs --app <name> [--wait ms] [--abort]"
  )
  process.exit(2)
}

const api = `https://api.machines.dev/v1/apps/${app}/machines`
const site = `https://${app}.fly.dev`

const machinesRes = await fetch(api, {
  headers: { authorization: `Bearer ${token}` },
})
if (!machinesRes.ok) {
  console.error(`[fly-drain] 列出 Machines 失败: ${machinesRes.status}`)
  process.exit(2)
}
const machines = await machinesRes.json()
const targets = machines.filter(
  (m) => m.state === "started" && m.id
)
if (targets.length === 0) {
  console.log("[fly-drain] 没有运行中的 Machine，无需排空")
  process.exit(0)
}
console.log(
  `[fly-drain] ${targets.length} 台实例进入 drain（wait=${waitMs}ms, abort=${abort}）`
)

let allQuiesced = true
for (const machine of targets) {
  const res = await fetch(`${site}/api/internal/drain`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cronSecret}`,
      "content-type": "application/json",
      "fly-force-instance-id": machine.id,
    },
    body: JSON.stringify({ waitMs, abort }),
    signal: AbortSignal.timeout(waitMs + 15_000),
  })
  if (!res.ok) {
    console.error(
      `[fly-drain] ${machine.id} drain 请求失败: ${res.status}`
    )
    allQuiesced = false
    continue
  }
  const body = await res.json()
  const active = body.drain?.activeGenerations ?? "?"
  const quiesced = body.quiesced === true || active === 0
  console.log(
    `[fly-drain] ${machine.id} draining=${body.drain?.draining} active=${active} quiesced=${body.quiesced}`
  )
  if (!quiesced) allQuiesced = false
}

if (!allQuiesced) {
  console.warn(
    "[fly-drain] 存在未排空的实例。若继续部署，SIGTERM 收尾仍会保住" +
      `最多 ${waitMs}ms 的收尾窗口（超限部分由心跳清扫兜底）。`
  )
  process.exit(0)
}
console.log("[fly-drain] 全部实例已排空，可以安全 fly deploy")
