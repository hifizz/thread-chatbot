import assert from "node:assert/strict"
import { test } from "node:test"
import { getSessionCookie } from "better-auth/cookies"
import { getAuthCookieOptions } from "../../lib/auth/cookie-options.ts"

test("乐观鉴权与 Better Auth 使用相同环境前缀（HTTP / HTTPS）", () => {
  const original = process.env.BETTER_AUTH_COOKIE_PREFIX
  try {
    for (const configured of [undefined, "", "  beta-ci  "]) {
      if (configured === undefined) delete process.env.BETTER_AUTH_COOKIE_PREFIX
      else process.env.BETTER_AUTH_COOKIE_PREFIX = configured
      const options = getAuthCookieOptions()
      assert.equal(options.cookiePrefix, configured?.trim() || "better-auth")
      for (const secure of ["", "__Secure-"]) {
        const request = new Request("https://example.test/account", {
          headers: { cookie: `${secure}${options.cookiePrefix}.session_token=test-session` },
        })
        assert.equal(getSessionCookie(request, options), "test-session")
      }
      assert.equal(getSessionCookie(new Request("https://example.test/account"), options), null)
      if (configured?.trim()) {
        assert.equal(getSessionCookie(new Request("https://example.test/account", {
          headers: { cookie: "better-auth.session_token=wrong-prefix" },
        }), options), null)
      }
    }
  } finally {
    if (original === undefined) delete process.env.BETTER_AUTH_COOKIE_PREFIX
    else process.env.BETTER_AUTH_COOKIE_PREFIX = original
  }
})
