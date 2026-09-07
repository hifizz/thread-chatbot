"use client"
import { useEffect } from "react"
import { createPortal } from "react-dom"
import { autoUpdate, flip, offset, shift, size, useFloating } from "@floating-ui/react"
import type { MenuOption, MenuResolution } from "@lexical/react/LexicalTypeaheadMenuPlugin"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"

/** 复用 Lexical 官方 NodeContextMenuPlugin 的 Floating UI 组合；只定位自己渲染的菜单。 */
export function ArtifactMenu<T extends MenuOption & { artifact: ArtifactDTO }>({ resolution, root, options, selectedIndex, setHighlightedIndex, selectOptionAndCleanUp }: {
  resolution: MenuResolution; root: HTMLElement | null; options: T[]; selectedIndex: number | null;
  setHighlightedIndex: (index: number) => void; selectOptionAndCleanUp: (option: T) => void
}) {
  const { refs: { setFloating, setPositionReference }, floatingStyles } = useFloating({
    open: true, placement: "bottom-start", strategy: "fixed",
    middleware: [offset(4), flip({ padding: 12 }), shift({ padding: 12 }), size({ padding: 12, apply({ availableHeight, availableWidth, elements }) {
      elements.floating.style.maxHeight = `${Math.max(0, Math.min(240, availableHeight))}px`
      elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`
    } })],
    // 只在菜单挂载时跟踪虚拟选区；包括画布 transform。不是对抗 Lexical anchor 的循环。
    whileElementsMounted: (reference, floating, update) => autoUpdate(reference, floating, update, { animationFrame: true }),
  })
  useEffect(() => {
    setPositionReference({ getBoundingClientRect: resolution.getRect, contextElement: root ?? undefined })
  }, [setPositionReference, resolution, root])
  useEffect(() => { if (selectedIndex !== null) options[selectedIndex]?.ref?.current?.scrollIntoView({ block: "nearest" }) }, [options, selectedIndex])
  return createPortal(<div ref={setFloating} style={floatingStyles} className="tc composer-artifact-menu" role="listbox" aria-label="Artifact 候选">
    {options.map((option, index) => <button key={option.key} id={`typeahead-item-${index}`} type="button" role="option" aria-selected={selectedIndex === index}
      ref={(element) => option.setRefElement(element)} className={selectedIndex === index ? "selected" : ""}
      onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setHighlightedIndex(index)} onClick={() => selectOptionAndCleanUp(option)}>
      <strong>{option.artifact.title}</strong><small>Markdown · {option.artifact.sourceThreadTitle ?? "未命名 Thread"}</small>
    </button>)}
  </div>, document.body)
}
