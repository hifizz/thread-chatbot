"use client"
import { useEffect } from "react"
import { createPortal } from "react-dom"
import { autoUpdate, flip, offset, shift, size, useFloating } from "@floating-ui/react"
import type { MenuOption, MenuResolution } from "@lexical/react/LexicalTypeaheadMenuPlugin"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import { FileTextIcon } from "lucide-react"
import { ComposerMenu, ComposerMenuItem } from "@/components/assistant-ui/elements/composer"
import { OfficialComposerTheme } from "@/components/assistant-ui/official-composer-demo/theme"
import { ARTIFACT_REFERENCE_COPY } from "@/constants/artifact-reference"

/** 复用 Lexical 官方 NodeContextMenuPlugin 的 Floating UI 组合；只定位自己渲染的菜单。 */
export function ArtifactMenu<T extends MenuOption & { artifact: ArtifactDTO }>({ resolution, root, query, options, selectedIndex, setHighlightedIndex, selectOptionAndCleanUp }: {
  resolution: MenuResolution; root: HTMLElement | null; options: T[]; selectedIndex: number | null;
  query: string;
  setHighlightedIndex: (index: number) => void; selectOptionAndCleanUp: (option: T) => void
}) {
  const { refs: { setFloating, setPositionReference }, floatingStyles } = useFloating({
    open: true, placement: "top-start", strategy: "fixed",
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 }), size({ padding: 12, apply({ availableHeight, availableWidth, elements }) {
      elements.floating.style.maxHeight = `${Math.max(0, Math.min(240, availableHeight))}px`
      elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`
    } })],
    // 只在菜单挂载时跟踪虚拟选区；包括画布 transform。不是对抗 Lexical anchor 的循环。
    whileElementsMounted: (reference, floating, update) => autoUpdate(reference, floating, update, { animationFrame: true }),
  })
  useEffect(() => {
    const composer = root?.closest<HTMLElement>('[data-slot="composer"]')
    setPositionReference(composer ?? { getBoundingClientRect: resolution.getRect, contextElement: root ?? undefined })
  }, [setPositionReference, resolution, root])
  useEffect(() => { if (selectedIndex !== null) options[selectedIndex]?.ref?.current?.scrollIntoView({ block: "nearest" }) }, [options, selectedIndex])
  return createPortal(<OfficialComposerTheme><ComposerMenu open ref={setFloating}
    style={{ ...floatingStyles, bottom: "auto", marginBottom: 0, zIndex: "var(--tc-z-selection, 100)" }}
    className="overflow-y-auto" role="listbox" aria-label={ARTIFACT_REFERENCE_COPY.picker}>
    {!options.length && <div className="flex min-h-14 items-center justify-center px-2 text-center text-sm text-foreground/45" role="status" onMouseDown={(event) => event.preventDefault()}>{query ? ARTIFACT_REFERENCE_COPY.noMatches : ARTIFACT_REFERENCE_COPY.empty}</div>}
    {options.map((option, index) => <ComposerMenuItem key={option.key} id={`typeahead-item-${index}`} role="option" aria-selected={selectedIndex === index}
      ref={(element) => option.setRefElement(element)} active={selectedIndex === index}
      onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setHighlightedIndex(index)} onClick={() => selectOptionAndCleanUp(option)}>
      <FileTextIcon className="size-5 shrink-0 text-foreground/45" />
      <span className="flex min-w-0 flex-1 flex-col text-start"><span className="truncate">{option.artifact.title}</span><span className="truncate text-xs text-foreground/45">Markdown · {option.artifact.sourceThreadTitle ?? "未命名 Thread"}</span></span>
    </ComposerMenuItem>)}
  </ComposerMenu></OfficialComposerTheme>, document.body)
}
