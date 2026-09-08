import assert from "node:assert/strict"
import { matchArtifactMention } from "../../lib/thread-chat/artifact-mention-match.ts"

for (const text of ["@", "请参考@", "before @", "one @first @second"]) {
  const match = matchArtifactMention(text)
  assert.ok(match, text)
  assert.equal(text.slice(match.leadOffset), match.replaceableString)
}
assert.equal(matchArtifactMention("请参考@项目说明").matchingString, "项目说明")
assert.equal(matchArtifactMention("@Alpha").matchingString, "Alpha")
for (const text of ["name@example.com", "@@", "@@@", "@Alpha@", "@ ", "@ 普通文字", "@Alpha ", "@Alpha Plan", "@\t", "@\u3000", "@Alpha\n", "@" + "a".repeat(81)]) {
  assert.equal(matchArtifactMention(text), null, text)
}
// 连续输入 @ 终止匹配；退格回到单个 @ 才重新打开面板。
assert.equal(matchArtifactMention("@@"), null)
assert.equal(matchArtifactMention("@").matchingString, "")
assert.equal(matchArtifactMention(""), null)
// 空格结束旧查询；后续输入新的 @ 可以重新查询。
assert.equal(matchArtifactMention("@ 普通文字 @项目").matchingString, "项目")
console.log("PASS Artifact mention: 中文、空查询、邮箱、连续 @、空白终止与查询位置")
