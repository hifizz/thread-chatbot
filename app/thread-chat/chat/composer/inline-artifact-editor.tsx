"use client"

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react"
import { createPortal } from "react-dom"
import {
  $getSelection, $isRangeSelection, COMMAND_PRIORITY_CRITICAL, COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW, KEY_ENTER_COMMAND, KEY_DOWN_COMMAND, COPY_COMMAND, CUT_COMMAND, PASTE_COMMAND,
  type LexicalEditor,
} from "lexical"
import { $getClipboardDataFromSelection, $insertDataTransferForRichText, setLexicalClipboardDataTransfer } from "@lexical/clipboard"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { LexicalTypeaheadMenuPlugin, MenuOption } from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { ARTIFACT_REFERENCE_COPY } from "@/constants/artifact-reference"
import type { InlineComposerPart } from "@/lib/thread-chat/contracts/artifact-reference"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import { ArtifactReferenceNode, $createArtifactReferenceNode } from "./artifact-reference-node"
import { $insertInlineText, $readInlineDocument, $writeInlineDocument } from "./inline-editor-document"
import { useArtifactResources } from "./artifact-composer-context"
import { artifactReferenceCandidates, matchArtifactTrigger } from "./artifact-typeahead"

export interface InlineArtifactEditorHandle {
  focus(): void
  insertText(text: string): void
}
interface EditorProps {
  value: InlineComposerPart[]
  onChange(value: InlineComposerPart[]): void
  onSubmit?(): void
  submitMode?: "enter" | "mod-enter"
  disabled?: boolean
  maxHeight?: number
  label?: string
  editorRef?: Ref<InlineArtifactEditorHandle>
  /** 编辑历史消息时的标题回退，不作为服务端权威。 */
  titles?: Record<string, string>
}

class ArtifactOption extends MenuOption {
  constructor(readonly artifact: ArtifactDTO) { super(artifact.id) }
}

function EditorPlugins({ value, onChange, onSubmit, submitMode, disabled, editorRef, titles }: EditorProps) {
  const [editor] = useLexicalComposerContext()
  const resources = useArtifactResources()
  const [query, setQuery] = useState<string | null>(null)
  const menuOpen = useRef(false)
  const submit = useRef(onSubmit)
  useEffect(() => { submit.current = onSubmit }, [onSubmit])
  const titleFor = useCallback((id: string) =>
    resources?.artifacts.find((artifact) => artifact.id === id)?.title ?? titles?.[id] ?? "Artifact",
  [resources?.artifacts, titles])
  const options = useMemo(() => artifactReferenceCandidates(resources?.artifacts ?? [], query)
    .map((artifact) => new ArtifactOption(artifact)), [resources?.artifacts, query])

  useImperativeHandle(editorRef, () => ({
    focus: () => editor.focus(),
    insertText: (text) => editor.focus(() => editor.update(() => $insertInlineText(text))),
  }), [editor])
  useEffect(() => { editor.setEditable(!disabled) }, [editor, disabled])
  useEffect(() => {
    const current = editor.getEditorState().read($readInlineDocument)
    if (JSON.stringify(current) === JSON.stringify(value)) return
    editor.update(() => $writeInlineDocument(value, titleFor), { tag: "external-draft" })
  }, [editor, value, titleFor])
  useEffect(() => editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
    // 在候选菜单和发送快捷键之前处理 IME，避免按 Enter 确认汉字时选中或发送。
    return event.isComposing || event.keyCode === 229 || editor.isComposing()
  }, COMMAND_PRIORITY_CRITICAL), [editor])
  useEffect(() => editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
    if (!event || event.shiftKey || event.isComposing || editor.isComposing() || !submit.current) return false
    if (submitMode === "mod-enter" && !event.ctrlKey && !event.metaKey) return false
    if (menuOpen.current) { event.preventDefault(); return true }
    event.preventDefault()
    submit.current()
    return true
  }, COMMAND_PRIORITY_LOW), [editor, submitMode])
  useEffect(() => {
    // PlainTextPlugin 默认只复制纯文本；补充内部结构化剪贴板以保留引用身份。
    const copySelection = (event: ClipboardEvent | KeyboardEvent | null, cut: boolean) => {
      const selection = $getSelection()
      if (!(event instanceof ClipboardEvent) || !event.clipboardData || !$isRangeSelection(selection) || selection.isCollapsed()) return false
      setLexicalClipboardDataTransfer(event.clipboardData, $getClipboardDataFromSelection(selection))
      event.preventDefault()
      if (cut) selection.removeText()
      return true
    }
    const removeCopy = editor.registerCommand(COPY_COMMAND, (event) => copySelection(event, false), COMMAND_PRIORITY_HIGH)
    const removeCut = editor.registerCommand(CUT_COMMAND, (event) => copySelection(event, true), COMMAND_PRIORITY_HIGH)
    const removePaste = editor.registerCommand(PASTE_COMMAND, (event) => {
      const selection = $getSelection()
      if (!(event instanceof ClipboardEvent) || !event.clipboardData || !$isRangeSelection(selection)) return false
      const raw = event.clipboardData.getData("application/x-lexical-editor")
      if (!raw) return false
      try {
        const payload = JSON.parse(raw)
        if (payload.namespace !== "ThreadChatInlineArtifact" || !Array.isArray(payload.nodes)) return false
      } catch { return false }
      event.preventDefault()
      $insertDataTransferForRichText(event.clipboardData, selection, editor)
      return true
    }, COMMAND_PRIORITY_HIGH)
    return () => { removeCopy(); removeCut(); removePaste() }
  }, [editor])

  return <>
    <HistoryPlugin />
    <OnChangePlugin ignoreSelectionChange onChange={(state) => {
      const next = state.read($readInlineDocument)
      if (JSON.stringify(next) !== JSON.stringify(value)) onChange(next)
    }} />
    <LexicalTypeaheadMenuPlugin<ArtifactOption>
      options={options}
      triggerFn={matchArtifactTrigger}
      onQueryChange={setQuery}
      onOpen={() => { menuOpen.current = true }}
      onClose={() => { menuOpen.current = false }}
      commandPriority={COMMAND_PRIORITY_HIGH}
      onSelectOption={(option, queryNode, close) => {
        editor.update(() => {
          const node = $createArtifactReferenceNode(option.artifact.id, option.artifact.title)
          if (queryNode) queryNode.replace(node)
          else {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) selection.insertNodes([node])
          }
          node.selectNext()
          close()
        })
      }}
      menuRenderFn={(anchor, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => anchor.current
        ? createPortal(<div className="tc artifact-reference-menu-root">
          <ul className="artifact-reference-menu" role="listbox" aria-label="引用项目 Artifact">
            {options.map((option, index) => <li
              key={option.key}
              id={`typeahead-item-${index}`}
              ref={(element) => { option.setRefElement(element) }}
              role="option"
              aria-selected={selectedIndex === index}
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOptionAndCleanUp(option)}
            >
              <span>{option.artifact.title}</span>
              <small>{option.artifact.kind} · {option.artifact.sourceThreadTitle ?? "来源 Thread"}</small>
              <small>{option.artifact.createdAt.slice(0, 19).replace("T", " ")} UTC</small>
            </li>)}
            {options.length === 0 && <li role="presentation">{ARTIFACT_REFERENCE_COPY.empty}</li>}
          </ul>
        </div>, anchor.current) : null}
    />
  </>
}

export function InlineArtifactEditor(props: EditorProps) {
  const resources = useArtifactResources()
  const initial = useRef(props.value)
  const titleFor = (id: string) => resources?.artifacts.find((a) => a.id === id)?.title ?? props.titles?.[id] ?? "Artifact"
  return <LexicalComposer initialConfig={{
    namespace: "ThreadChatInlineArtifact",
    nodes: [ArtifactReferenceNode],
    onError: (error: Error, editor: LexicalEditor) => {
      console.error("[ThreadChat Composer]", error)
      editor.setEditable(false)
    },
    editorState: () => $writeInlineDocument(initial.current, titleFor),
  }}>
    <div className="inline-artifact-editor" onClick={(event) => {
      const token = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-artifact-id]") : null
      if (token?.dataset.artifactId) resources?.openArtifact(token.dataset.artifactId)
    }}>
      <PlainTextPlugin
        contentEditable={<ContentEditable
          className="inline-artifact-input"
          aria-label={props.label ?? "消息输入框"}
          aria-placeholder={ARTIFACT_REFERENCE_COPY.placeholder}
          placeholder={<div className="inline-artifact-placeholder">{ARTIFACT_REFERENCE_COPY.placeholder}</div>}
          style={{ maxHeight: props.maxHeight ?? 120 }}
        />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <EditorPlugins {...props} />
    </div>
  </LexicalComposer>
}
