import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import type { ReactElement } from "react"

import { cn } from "@/lib/utils"

import styles from "./landing.module.css"
import type { LandingCtaLinkProps } from "./types"

export function LandingCtaLink({
  cta,
  className,
}: LandingCtaLinkProps): ReactElement {
  return (
    <Link
      href={cta.href}
      className={cn(styles.ctaLink, className)}
      aria-label={cta.accessibleLabel ?? cta.label}
    >
      <span>{cta.label}</span>
      <ArrowUpRight aria-hidden className={styles.ctaIcon} />
    </Link>
  )
}
