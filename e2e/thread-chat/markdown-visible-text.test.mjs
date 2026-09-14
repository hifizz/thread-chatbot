import assert from "node:assert/strict"
import { locateArtifactAnchor, markdownVisibleText } from "../../lib/thread-chat/domain/markdown-visible-text.ts"

const anchor = (exact, prefix = "", suffix = "") => ({ quote: { exact, prefix, suffix } })
for (const [markdown, exact] of [
  ["字段名为 `judge_score`。", "judge_score"],
  ["条件为 `a < b && c > d`。", "a < b && c > d"],
  ["正文 A &amp; B &#x4E2D;。", "A & B 中"],
  ["转义 \\*星号\\* 与 foo_bar。", "*星号* 与 foo_bar"],
  ["采用 **AI Judge** 对回答评分。", "采用 AI Judge 对回答评分。"],
  ["[评测方法][judge]\n\n[judge]: https://example.com", "评测方法"],
  ["```ts\nconst judge_score = a < b && c > d\n```", "judge_score = a < b && c > d"],
]) assert.ok(locateArtifactAnchor(markdown, anchor(exact)), exact)
assert.equal(locateArtifactAnchor("[正文](https://secret.example)", anchor("secret.example")), null)
assert.equal(locateArtifactAnchor("![不可划选的图片替代文字](image.png)", anchor("不可划选")), null)
const repeated = "前甲：采用 AI Judge 评分。尾甲\n\n前乙：采用 AI Judge 评分。尾乙"
assert.equal(locateArtifactAnchor(repeated, anchor("采用 AI Judge 评分。")), null)
const matched = locateArtifactAnchor(repeated, anchor("采用 AI Judge 评分。", "前乙：", "尾乙"))
assert.equal(matched.start, markdownVisibleText(repeated).lastIndexOf("采用 AI Judge 评分。"))
console.log("PASS Markdown 可见文字：行内/块代码、实体、转义、强调、引用链接、重复选区消歧和隐藏 URL 拒绝")
