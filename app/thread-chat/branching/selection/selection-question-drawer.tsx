"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Drawer, DrawerClose, DrawerContent, DrawerDescription,
  DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer"

/** 仅手机提问外壳；选区快照和草稿由父组件持有，收起不丢失。 */
export function SelectionQuestionDrawer({ open, text, question, onQuestionChange, onClose, onSubmit }: {
  open: boolean
  text: string
  question: string
  onQuestionChange(value: string): void
  onClose(): void
  onSubmit(): void
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [viewport, setViewport] = useState<{ height: number; bottom: number } | null>(null)
  useEffect(() => {
    const visual = window.visualViewport
    if (!visual || !open) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setViewport({
        height: visual.height,
        bottom: Math.max(0, window.innerHeight - visual.height - visual.offsetTop),
      }))
    }
    update()
    visual.addEventListener("resize", update)
    visual.addEventListener("scroll", update)
    return () => {
      cancelAnimationFrame(frame)
      visual.removeEventListener("resize", update)
      visual.removeEventListener("scroll", update)
    }
  }, [open])

  return <Drawer open={open} showSwipeHandle swipeDirection="down" onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
    <DrawerContent data-question-dialog-open="true" data-selection-drawer initialFocus={inputRef} finalFocus={false}
      portalClassName="tc selection-question-portal"
      style={viewport ? { bottom: viewport.bottom, maxHeight: Math.max(0, viewport.height - 24) } : undefined}>
      <DrawerHeader>
        <DrawerTitle>此处提问</DrawerTitle>
        <DrawerDescription>围绕选中的内容，开启分支讨论</DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <details className="rounded-lg bg-muted p-3 text-sm">
          <summary className="cursor-pointer truncate">引用：{text}</summary>
          <p className="mt-2 whitespace-pre-wrap break-words">{text}</p>
        </details>
        <Textarea ref={inputRef} value={question} rows={3} className="min-h-24 shrink-0 text-base"
          aria-label="就这段内容提问" placeholder="就这段问点什么…（可留空）" enterKeyHint="enter"
          onChange={(event) => onQuestionChange(event.target.value)} />
      </div>
      <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button onClick={onSubmit}>{question.trim() ? "带着问题开分支" : "开启分支讨论"}</Button>
        <DrawerClose render={<Button variant="outline" />}>收起，稍后继续</DrawerClose>
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
}
