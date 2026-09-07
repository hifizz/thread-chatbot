import { ARTIFACT_MENTION_MAX_QUERY_LENGTH } from "@/constants/artifact-reference"

/** 只匹配光标前最后一个有效 @；邮箱、连续 @ 和空白字符会结束当前查询。 */
export function matchArtifactMention(text: string) {
  const match = /(?:^|[^a-zA-Z0-9_@])@([^@\s]*)$/.exec(text)
  if (!match || match[1].length > ARTIFACT_MENTION_MAX_QUERY_LENGTH) return null
  const query = match[1]
  return { leadOffset: text.length - query.length - 1, matchingString: query, replaceableString: `@${query}` }
}
