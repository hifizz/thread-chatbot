import type { FC, SVGProps } from "react"

/**
 * The Markdown mark (the classic "M↓" logo, public domain), sized and colored
 * like a lucide icon so it drops into the same slots.
 */
export const MarkdownIcon: FC<SVGProps<SVGSVGElement>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 208 128"
    fill="none"
    aria-hidden
    {...props}
  >
    <rect
      x="7"
      y="7"
      width="194"
      height="114"
      rx="12"
      stroke="currentColor"
      strokeWidth="14"
    />
    <path
      d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39zm125 0l-30-33h20V30h20v35h20z"
      fill="currentColor"
    />
  </svg>
)
