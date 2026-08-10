import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import {
  AUTO_WEB_SEARCH_MAX_CALLS,
  AUTO_WEB_SEARCH_MAX_RESULTS,
  AUTO_WEB_SEARCH_QUERY_CHAR_LIMIT,
  AUTO_WEB_SEARCH_SNIPPET_CHAR_LIMIT,
  AUTO_WEB_SEARCH_TEST_MAX_CALLS_CAP,
  AUTO_WEB_SEARCH_TEST_MAX_STEPS_CAP,
  THREAD_CHAT_MAX_STEPS,
} from "../../constants/web-search.ts"
import {
  AutoWebSearchError,
  autoWebSearch,
  normalizeAutoSearchResults,
  normalizePublicSearchUrl,
  preferredOfficialDomains,
} from "../../lib/ai/search.ts"
import {
  autoWebSearchInputSchema,
  createAutoWebSearchBudget,
  createAutoWebSearchTool,
  repairAutoWebSearchToolCall,
  resolveAutoWebSearchFeature,
  resolveAutoWebSearchRuntimeLimits,
} from "../../lib/chat/auto-web-search.ts"

const originalSearchApiKey = process.env.SEARCH_API_KEY

before(() => {
  process.env.SEARCH_API_KEY = "test-key-never-sent"
})

after(() => {
  if (originalSearchApiKey === undefined) delete process.env.SEARCH_API_KEY
  else process.env.SEARCH_API_KEY = originalSearchApiKey
})

describe("Auto Web Search 输入与结果边界", () => {
  it("拒绝 null、空、超长和额外字段", () => {
    assert.equal(autoWebSearchInputSchema.safeParse({ query: null }).success, false)
    assert.equal(autoWebSearchInputSchema.safeParse({ query: "   " }).success, false)
    assert.equal(
      autoWebSearchInputSchema.safeParse({
        query: "x".repeat(AUTO_WEB_SEARCH_QUERY_CHAR_LIMIT + 1),
      }).success,
      false
    )
    assert.equal(
      autoWebSearchInputSchema.safeParse({ query: "Next.js 16", extra: true })
        .success,
      false
    )
  })

  it("有限 repair 只修复可验证 query，不放行无效参数", async () => {
    const baseCall = {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "webSearch",
    }
    assert.equal(
      await repairAutoWebSearchToolCall({
        toolCall: { ...baseCall, input: JSON.stringify({ query: null }) },
      }),
      null
    )
    assert.equal(
      await repairAutoWebSearchToolCall({
        toolCall: {
          ...baseCall,
          input: JSON.stringify({ query: "x".repeat(AUTO_WEB_SEARCH_QUERY_CHAR_LIMIT + 1) }),
        },
      }),
      null
    )
    assert.deepEqual(
      await repairAutoWebSearchToolCall({
        toolCall: {
          ...baseCall,
          input: JSON.stringify({ query: "  Next.js 16  ", ignored: true }),
        },
      }),
      { ...baseCall, input: JSON.stringify({ query: "Next.js 16" }) }
    )
  })

  it("过滤危险 URL 并 canonicalize 公开 URL", () => {
    for (const value of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "http://user:pass@example.com/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fd00::1]/",
      "http://localhost/",
    ]) {
      assert.equal(normalizePublicSearchUrl(value), null, value)
    }

    assert.equal(
      normalizePublicSearchUrl(
        "HTTPS://Example.COM/docs?utm_source=test&b=2&a=1#install"
      ),
      "https://example.com/docs?a=1&b=2"
    )
  })

  it("按 canonical URL 去重、最多三条并截断 snippet", () => {
    const results = normalizeAutoSearchResults([
      {
        title: "A",
        url: "https://example.com/a?utm_source=x",
        content: "a".repeat(AUTO_WEB_SEARCH_SNIPPET_CHAR_LIMIT + 50),
      },
      { title: "duplicate", url: "https://example.com/a", content: "b" },
      { title: "private", url: "http://192.168.1.2", content: "c" },
      { title: "B", url: "https://example.com/b", content: "b" },
      { title: "C", url: "https://example.com/c", content: "c" },
      { title: "D", url: "https://example.com/d", content: "d" },
    ])

    assert.equal(results.length, AUTO_WEB_SEARCH_MAX_RESULTS)
    assert.equal(results[0].snippet.length, AUTO_WEB_SEARCH_SNIPPET_CHAR_LIMIT)
    assert.equal(new Set(results.map((result) => result.url)).size, results.length)
    assert.ok(results.every((result) => result.sourceId.startsWith("src_")))
  })

  it("只为命中的版本化编程主题添加官方域提示", () => {
    assert.deepEqual(preferredOfficialDomains("Next.js on Vercel"), [
      "nextjs.org",
      "vercel.com",
    ])
    assert.deepEqual(preferredOfficialDomains("解释闭包"), [])
  })
})

describe("Tavily Basic adapter", () => {
  it("固定 basic、关闭 provider answer、最多三条且不泄漏 wire format", async () => {
    let requestBody
    const response = await autoWebSearch(" Next.js 16 current docs ", {
      fetch: async (_url, init) => {
        requestBody = JSON.parse(init.body)
        return new Response(
          JSON.stringify({
            answer: "provider-generated answer must be ignored",
            results: [
              {
                title: "Docs",
                url: "https://nextjs.org/docs",
                content: "Official docs",
                score: 0.99,
              },
            ],
            usage: { credits: 1 },
          })
        )
      },
    })

    assert.deepEqual(requestBody, {
      query: "Next.js 16 current docs",
      max_results: 3,
      search_depth: "basic",
      include_answer: false,
      include_usage: true,
      include_domains: ["nextjs.org"],
    })
    assert.deepEqual(response, {
      results: [
        {
          sourceId: response.results[0].sourceId,
          title: "Docs",
          url: "https://nextjs.org/docs",
          snippet: "Official docs",
        },
      ],
      providerCredits: 1,
    })
  })

  it("分类 timeout、429、空结果和全过滤", async () => {
    const cases = [
      {
        code: "rate_limited",
        fetch: async () => new Response("", { status: 429 }),
      },
      {
        code: "empty_results",
        fetch: async () =>
          new Response(JSON.stringify({ results: [], usage: { credits: 1 } })),
      },
      {
        code: "all_results_filtered",
        fetch: async () =>
          new Response(
            JSON.stringify({
              results: [{ url: "http://127.0.0.1/", content: "unsafe" }],
              usage: { credits: 1 },
            })
          ),
      },
      {
        code: "timeout",
        fetch: async (_url, init) => {
          await new Promise((resolve, reject) => {
            init.signal.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true }
            )
          })
        },
        timeoutMs: 1,
      },
    ]

    for (const item of cases) {
      await assert.rejects(
        () =>
          autoWebSearch("query", {
            fetch: item.fetch,
            timeoutMs: item.timeoutMs,
          }),
        (error) =>
          error instanceof AutoWebSearchError && error.code === item.code,
        item.code
      )
    }
  })
})

describe("请求级预算、计量 hook 与灰度", () => {
  it("同一步并行只启动一次、跨步最多启动两次 provider 请求", async () => {
    const budget = createAutoWebSearchBudget()
    const attempts = []
    let started = 0
    const search = async (query) => {
      started += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return {
        results: [
          {
            sourceId: `src_${query}`,
            title: query,
            url: `https://example.com/${query}`,
            snippet: query,
          },
        ],
        providerCredits: 1,
      }
    }
    const searchTool = createAutoWebSearchTool({
      budget,
      search,
      onProviderAttempt: (attempt) => attempts.push(attempt),
    })

    const results = await Promise.all([
      searchTool.execute({ query: "one" }),
      searchTool.execute({ query: "two" }),
      searchTool.execute({ query: "three" }),
    ])

    assert.equal(started, 1)
    assert.equal(budget.startedCount, 1)
    assert.equal(
      results.filter((result) => result.status === "budget_exhausted").length,
      2
    )
    assert.equal(attempts.length, 1)
    budget.beginStep()
    const secondStep = await searchTool.execute({ query: "follow-up" })
    assert.equal(secondStep.status, "success")
    assert.equal(started, AUTO_WEB_SEARCH_MAX_CALLS)
    assert.equal(budget.startedCount, AUTO_WEB_SEARCH_MAX_CALLS)
    assert.deepEqual(attempts.map((attempt) => attempt.callIndex), [0, 1])
    assert.ok(
      attempts.every(
        (attempt) =>
          /^[a-f0-9]{64}$/.test(attempt.queryFingerprint) &&
          !("query" in attempt)
      )
    )
  })

  it("生产默认关闭、开发默认开启、kill switch 优先且 rollout 稳定", () => {
    assert.deepEqual(
      resolveAutoWebSearchFeature({ nodeEnv: "development", env: {} }),
      { enabled: true, reason: "development_default" }
    )
    assert.deepEqual(
      resolveAutoWebSearchFeature({ nodeEnv: "production", env: {} }),
      { enabled: false, reason: "production_disabled" }
    )
    assert.deepEqual(
      resolveAutoWebSearchFeature({
        subjectId: "internal-1",
        nodeEnv: "production",
        env: { AUTO_WEB_SEARCH_INTERNAL_USER_IDS: "internal-1" },
      }),
      { enabled: true, reason: "internal_user" }
    )
    assert.deepEqual(
      resolveAutoWebSearchFeature({
        subjectId: "internal-1",
        nodeEnv: "development",
        env: { AUTO_WEB_SEARCH_KILL_SWITCH: "true" },
      }),
      { enabled: false, reason: "kill_switch" }
    )
    assert.deepEqual(
      resolveAutoWebSearchFeature({
        subjectId: "anyone",
        nodeEnv: "production",
        env: {
          AUTO_WEB_SEARCH_ENABLED: "true",
          AUTO_WEB_SEARCH_ROLLOUT_PERCENT: "100",
        },
      }),
      { enabled: true, reason: "rollout" }
    )
  })

  it("高搜索预算只允许显式非生产测试，并为最终回答保留一个 step", () => {
    assert.deepEqual(
      resolveAutoWebSearchRuntimeLimits({
        nodeEnv: "development",
        env: { AUTO_WEB_SEARCH_TEST_MAX_CALLS: "10" },
      }),
      {
        maxCalls: AUTO_WEB_SEARCH_TEST_MAX_CALLS_CAP,
        maxSteps: AUTO_WEB_SEARCH_TEST_MAX_STEPS_CAP,
      }
    )
    assert.deepEqual(
      resolveAutoWebSearchRuntimeLimits({
        nodeEnv: "production",
        env: { AUTO_WEB_SEARCH_TEST_MAX_CALLS: "10" },
      }),
      {
        maxCalls: AUTO_WEB_SEARCH_MAX_CALLS,
        maxSteps: THREAD_CHAT_MAX_STEPS,
      }
    )
    assert.deepEqual(
      resolveAutoWebSearchRuntimeLimits({
        nodeEnv: "development",
        env: { AUTO_WEB_SEARCH_TEST_MAX_CALLS: "not-a-number" },
      }),
      {
        maxCalls: AUTO_WEB_SEARCH_MAX_CALLS,
        maxSteps: THREAD_CHAT_MAX_STEPS,
      }
    )
  })

  it("测试预算仍按 step 串行限制，并且不会超过十次", () => {
    const budget = createAutoWebSearchBudget(
      AUTO_WEB_SEARCH_TEST_MAX_CALLS_CAP,
      AUTO_WEB_SEARCH_TEST_MAX_CALLS_CAP
    )

    for (let index = 0; index < AUTO_WEB_SEARCH_TEST_MAX_CALLS_CAP; index += 1) {
      assert.equal(budget.tryAcquire().ok, true)
      assert.equal(budget.tryAcquire().ok, false)
      budget.beginStep()
    }

    assert.equal(budget.startedCount, AUTO_WEB_SEARCH_TEST_MAX_CALLS_CAP)
    assert.equal(budget.tryAcquire().ok, false)
  })
})
