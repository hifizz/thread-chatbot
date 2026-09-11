"use client"
import { Popover } from "@base-ui/react/popover"
import type { ReactNode, RefObject } from "react"

type Props = {
  anchor: RefObject<HTMLElement | null>
  boundary: HTMLElement | null
  children: ReactNode
  className: string
  side: "top" | "bottom"
  align: "start" | "center"
  sideOffset?: number
}

/** Keep portalled demo overlays inside the landing page's isolated style scope. */
export function DemoPopoverContent({ anchor, boundary, children, className, side, align, sideOffset = 4 }: Props) {
  if (!boundary) return null
  return <Popover.Portal container={boundary}>
    <Popover.Positioner anchor={anchor} side={side} align={align} sideOffset={sideOffset} collisionBoundary={boundary} collisionPadding={12} className="demo-popover-positioner">
      <Popover.Popup className={className} initialFocus={false} finalFocus={false}>{children}</Popover.Popup>
    </Popover.Positioner>
  </Popover.Portal>
}
