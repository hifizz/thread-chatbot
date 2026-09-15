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
assert.ok(locateArtifactAnchor("甲  \n乙", anchor("甲\n乙")), "硬换行在 DOM 中保留 \\n 文本节点")
assert.ok(locateArtifactAnchor("<div>x</div>\n\n目标", anchor("<div>x</div>")), "html 源码以文本形式渲染，可划选")
assert.ok(locateArtifactAnchor("<div>x</div>\n\n目标", anchor("目标")), "html 之后的文字仍可定位")
assert.ok(locateArtifactAnchor("跨 <span>内联</span> 标签", anchor("<span>内联</span>")), "行内 html 标签作为可见文本计入")
assert.ok(locateArtifactAnchor("正文[^a]。\n\n[^a]: 脚注正文内容", anchor("脚注正文内容")), "脚注正文渲染在文末，可划选")
const repeated = "前甲：采用 AI Judge 评分。尾甲\n\n前乙：采用 AI Judge 评分。尾乙"
assert.equal(locateArtifactAnchor(repeated, anchor("采用 AI Judge 评分。")), null)
const matched = locateArtifactAnchor(repeated, anchor("采用 AI Judge 评分。", "前乙：", "尾乙"))
assert.equal(matched.start, markdownVisibleText(repeated).lastIndexOf("采用 AI Judge 评分。"))
console.log("PASS Markdown 可见文字：行内/块代码、实体、转义、强调、引用链接、重复选区消歧和隐藏 URL 拒绝")
