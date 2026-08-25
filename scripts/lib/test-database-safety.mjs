import { config } from "dotenv"

export const TEST_DATABASE_NAME = "thread-chat-test"

/** 只加载测试连接变量；数据库配置禁止回退到开发库连接。 */
export function loadTestDatabaseEnvironment() {
  config({ path: [".env.test.local", ".env.local"], quiet: true })
}

/**
 * 返回经过 allowlist 校验的测试数据库 URL。任何其他数据库名都会立即终止测试操作。
 *
 * @param {string | undefined} rawUrl
 */
export function assertSafeTestDatabaseUrl(rawUrl) {
  if (!rawUrl) {
    throw new Error(
      "未配置 TEST_DATABASE_URL；测试数据库操作已停止，且不会回退到 DATABASE_URL。"
    )
  }

  const normalized = rawUrl.trim().replace(/^(['"])(.*)\1$/, "$2")
  let url
  try {
    url = new URL(normalized)
  } catch {
    throw new Error("TEST_DATABASE_URL 不是合法的 PostgreSQL URL。")
  }

  if (!url.protocol.startsWith("postgres")) {
    throw new Error("TEST_DATABASE_URL 必须使用 postgres 协议。")
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1))
  if (databaseName !== TEST_DATABASE_NAME) {
    throw new Error(
      `拒绝操作数据库 ${JSON.stringify(databaseName)}；测试 allowlist 仅包含 ${TEST_DATABASE_NAME}。`
    )
  }

  return url.toString()
}
