"use client"

import { useCallback, useMemo, useState } from "react"
import { $getSelection, $isRangeSelection, COMMAND_PRIORITY_HIGH } from "lexical"
import { ArtifactMenu } from "./artifact-menu"
import { LexicalTypeaheadMenuPlugin, MenuOption, type MenuResolution } from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import { $createComposerCapsuleNode } from "./composer-capsule-node"

class ArtifactOption extends MenuOption {
  constructor(readonly artifact: ArtifactDTO) { super(artifact.id) }
}
export function ArtifactMentionPlugin({ artifacts }: { artifacts: Record<string, ArtifactDTO> }) {
  const [editor] = useLexicalComposerContext()
  const [resolution, setResolution] = useState<MenuResolution | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const options = useMemo(() => {
    if (query === null) return []
    const needle = query.toLocaleLowerCase()
    return Object.values(artifacts)
      .filter((item) => item.kind === "markdown" && item.sourceMessageStatus === "completed" &&
        `${item.title} Markdown ${item.sourceThreadTitle ?? ""}`.toLocaleLowerCase().includes(needle))
      .map((item) => new ArtifactOption(item))
  }, [artifacts, query])
  const triggerFn = useCallback((text: string) => {
    // 中文前缀允许直接触发；邮箱中的 ASCII 单词前缀不触发。
    const match = /(?:^|[^a-zA-Z0-9_@])@([^@\n]{0,80})$/.exec(text)
    if (!match || editor.isComposing()) return null
    const query = match[1]
    return { leadOffset: text.length - query.length - 1, matchingString: query, replaceableString: `@${query}` }
  }, [editor])
  return <LexicalTypeaheadMenuPlugin
    options={options}
    onQueryChange={setQuery}
    triggerFn={triggerFn}
    commandPriority={COMMAND_PRIORITY_HIGH}
    onOpen={setResolution}
    onClose={() => setResolution(null)}
    preselectFirstItem
    anchorClassName="composer-typeahead-anchor"
    onSelectOption={(option, queryNode, close) => {
      editor.update(() => {
        const node = $createComposerCapsuleNode({ type: "artifact-reference", artifactId: option.artifact.id, localId: crypto.randomUUID() }, `@${option.artifact.title}`)
        if (queryNode) queryNode.replace(node)
        else { const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertNodes([node]) }
        node.selectNext()
        close()
      })
    }}
    menuRenderFn={(_anchor, props) => resolution
      ? <ArtifactMenu resolution={resolution} root={editor.getRootElement()} {...props} /> : null}
  />
}
