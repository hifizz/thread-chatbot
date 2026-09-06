import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import { ARTIFACT_REFERENCE_MENU_LIMIT } from "@/constants/artifact-reference"

/** 允许“参考@结论”这类中文输入；邮箱中的 @ 仍是普通文字。 */
export function matchArtifactTrigger(text: string) {
  const match = /(^|[\s(（，。；：！？、\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])(@([^@\s()（），。；：！？、]{0,75}))$/u.exec(text)
  return match ? {
    leadOffset: match.index + match[1].length,
    matchingString: match[3],
    replaceableString: match[2],
  } : null
}

export function artifactReferenceCandidates(artifacts: ArtifactDTO[], query: string | null) {
  return artifacts
    .filter((artifact) => artifact.sourceMessageStatus === "completed")
    .filter((artifact) => [artifact.title, artifact.kind, artifact.sourceThreadTitle ?? ""]
      .join(" ").toLocaleLowerCase().includes((query ?? "").toLocaleLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, ARTIFACT_REFERENCE_MENU_LIMIT)
}
