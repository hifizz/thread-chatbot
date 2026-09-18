import assert from "node:assert/strict"

// 部署收尾状态机与启动环境白名单的纯逻辑测试（不依赖数据库）。
const [{ createDrainController }, { checkRuntimeEnv }, generation] =
  await Promise.all([
    import("../../lib/runtime/drain.ts"),
    import("../../lib/runtime/env.ts"),
    import("../../constants/generation.ts"),
  ])

const DEPLOY = generation.GENERATION_CANCEL_REASONS.deployDrain

// ---- drain 状态机 ----
{
  let active = 2
  const aborted = []
  const logs = []
  const controller = createDrainController({
    activeGenerations: () => active,
    activeDeliveries: () => 0,
    abortAll: (reason) => {
      aborted.push(reason)
      const n = active
      active = 0
      return n
    },
    log: (event, data) => logs.push([event, data]),
    now: () => Date.now(),
    exit: () => {},
  })

  assert.equal(controller.isDraining(), false)
  assert.equal(controller.state().acceptingNewGenerations, true)

  // graceful drain：只关准入，不中止在途任务。
  const state = controller.begin({ abortInFlight: false })
  assert.equal(state.draining, true)
  assert.equal(state.acceptingNewGenerations, false)
  assert.equal(aborted.length, 0, "graceful drain 不得中止在途 Generation")

  // 重复 begin 幂等，不再重复 abort。
  controller.begin({ abortInFlight: true })
  assert.equal(aborted.length, 0)

  // graceful 超时后的显式强制手段。
  active = 1
  assert.equal(controller.abortRemaining(), 1)
  assert.deepEqual(aborted, [DEPLOY])
}

// waitForQuiesce：排空返回 true，超时返回 false。
{
  let active = 1
  const controller = createDrainController({
    activeGenerations: () => active,
    abortAll: () => 0,
    log: () => {},
    exit: () => {},
  })
  setTimeout(() => {
    active = 0
  }, 350)
  assert.equal(await controller.waitForQuiesce(2_000), true)

  active = 5
  assert.equal(await controller.waitForQuiesce(300), false)
}

// begin 默认（缺省 abortInFlight）按信号收尾语义中止在途任务。
{
  const aborted = []
  const controller = createDrainController({
    activeGenerations: () => 1,
    abortAll: (reason) => {
      aborted.push(reason)
      return 1
    },
    log: () => {},
    exit: () => {},
  })
  controller.begin()
  assert.deepEqual(aborted, [DEPLOY])
}

// ---- 环境白名单 ----
{
  const base = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s".repeat(32),
    TOKEN_ROUTER_BASE_URL: "https://router.example/v1",
    TOKEN_ROUTER_API_KEY: "k",
  }
  // 非 Fly：required 齐全即 ok，optional 缺失只警告。
  const local = checkRuntimeEnv(base)
  assert.equal(local.ok, true)
  assert.equal(local.fly, false)
  assert.ok(local.warnings.length > 0)

  // Fly：追加 Server Actions 加密键与 CRON_SECRET 要求。
  const flyMissing = checkRuntimeEnv({
    ...base,
    FLY_APP_NAME: "thread-chat",
    FLY_MACHINE_ID: "abc123",
  })
  assert.equal(flyMissing.ok, false)
  assert.ok(flyMissing.missing.includes("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"))
  assert.ok(flyMissing.missing.includes("CRON_SECRET"))

  const flyOk = checkRuntimeEnv({
    ...base,
    FLY_APP_NAME: "thread-chat",
    FLY_MACHINE_ID: "abc123",
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    CRON_SECRET: "x".repeat(24),
  })
  assert.equal(flyOk.ok, true)

  // 弱 secret 必须被识别为格式不合法。
  const weak = checkRuntimeEnv({
    ...base,
    BETTER_AUTH_SECRET: "short",
    FLY_APP_NAME: "a",
    FLY_MACHINE_ID: "b",
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: "not-base64!!!",
    CRON_SECRET: "x".repeat(24),
  })
  assert.ok(weak.invalid.includes("BETTER_AUTH_SECRET"))
  assert.ok(weak.invalid.includes("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"))

  // R2 半配必须警告。
  const r2Half = checkRuntimeEnv({ ...base, R2_ACCOUNT_ID: "x" })
  assert.ok(
    r2Half.warnings.some((w) => w.includes("R2")),
    "R2 半配必须产生警告"
  )
}

console.log("drain controller & runtime env tests passed")
