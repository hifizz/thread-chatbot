import assert from "node:assert/strict"

process.env.BETTER_AUTH_SECRET ??= "privacy-unit-test-secret-at-least-32-characters"

const cookie = await import("../../lib/privacy/consent-cookie.ts")
const gate = await import("../../lib/privacy/analytics-gate.ts")

const accepted = cookie.createConsentCookiePayload({
  decision: "accepted",
  now: new Date("2026-09-18T00:00:00.000Z"),
})
const encoded = cookie.encodeConsentCookie(accepted)
assert.deepEqual(cookie.decodeConsentCookie(encoded), accepted)
assert.equal(cookie.decodeConsentCookie(`${encoded.slice(0, -1)}x`), null)
assert.equal(
  cookie.consentStateFromPayload(accepted, new Date("2026-09-19T00:00:00.000Z")).state,
  "valid"
)
assert.equal(
  cookie.consentStateFromPayload(accepted, new Date("2027-09-19T00:00:00.000Z")).state,
  "expired"
)

const rejected = cookie.createConsentCookiePayload({ decision: "rejected", previous: accepted })
assert.equal(rejected.analytics, false)
assert.equal(rejected.revision, 2)
assert.equal(rejected.deviceId, accepted.deviceId)

assert.equal(gate.isSafeAnalyticsEvent({ name: "thread.branch_created", properties: { depth: 2 } }), true)
assert.equal(gate.isSafeAnalyticsEvent({ name: "thread.sent", properties: { prompt: "secret" } }), false)
assert.equal(gate.isSafeAnalyticsEvent({ name: "thread.sent", properties: { full_url: "/?token=x" } }), false)
assert.equal(gate.isSafeAnalyticsEvent({ name: "Invalid Event" }), false)

console.log("privacy contract tests passed")

