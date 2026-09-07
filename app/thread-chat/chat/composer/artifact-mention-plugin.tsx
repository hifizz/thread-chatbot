"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { $createTextNode, $getSelection, $isRangeSelection, COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND } from "lexical"
import { ArtifactMenu } from "./artifact-menu"
import { LexicalTypeaheadMenuPlugin, MenuOption, type MenuResolution } from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import { $createComposerCapsuleNode } from "./composer-capsule-node"
import { matchArtifactMention } from "@/lib/thread-chat/artifact-mention-match"

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
    return editor.isComposing() ? null : matchArtifactMention(text)
  }, [editor])
  useEffect(() => editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
    if (!resolution || options.length || !event || editor.isComposing()) return false
    event.preventDefault()
    return true
  }, COMMAND_PRIORITY_HIGH), [editor, options.length, resolution])
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
        // 显式保留胶囊之后的文字落点，后续输入不会替换引用节点。
        const space = $createTextNode(" ")
        node.insertAfter(space)
        space.selectEnd()
        close()
      })
    }}
    menuRenderFn={(_anchor, props) => resolution
      ? <ArtifactMenu resolution={resolution} root={editor.getRootElement()} query={query ?? ""} {...props} /> : null}
  />
}
