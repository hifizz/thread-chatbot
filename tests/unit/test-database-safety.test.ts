import { describe, expect, it } from "vitest"
import {
  assertSafeTestDatabaseUrl,
  TEST_DATABASE_NAME,
} from "../../scripts/lib/test-database-safety.mjs"

describe("测试数据库安全检查", () => {
  it("只接受 allowlist 中的物理测试数据库", () => {
    const result = assertSafeTestDatabaseUrl(
      `postgres://postgres:postgres@localhost:5432/${TEST_DATABASE_NAME}`
    )

    expect(new URL(result).pathname).toBe(`/${TEST_DATABASE_NAME}`)
  })

  it("拒绝开发数据库并且不回退", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgres://postgres:postgres@localhost:5432/thread-chat"
      )
    ).toThrow(/拒绝操作数据库/)
    expect(() => assertSafeTestDatabaseUrl(undefined)).toThrow(
      /不会回退到 DATABASE_URL/
    )
  })
})
