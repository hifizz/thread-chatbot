import Link from "next/link"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import type { ReactElement } from "react"

import { cn } from "@/lib/utils"

import styles from "./landing.module.css"
import type { LandingCtaLinkProps } from "./types"

export function LandingCtaLink({
  cta,
  tone,
  className,
}: LandingCtaLinkProps): ReactElement {
  const linkClassName = cn(
    styles.ctaLink,
    tone === "primary" && styles.ctaPrimary,
    tone === "secondary" && styles.ctaSecondary,
    tone === "text" && styles.ctaText,
    className
  )
  const label = cta.accessibleLabel ?? cta.label
  const content = (
    <>
      <span>{cta.label}</span>
      {cta.external ? (
        <ArrowUpRight aria-hidden className={styles.ctaIcon} />
      ) : (
        <ArrowRight aria-hidden className={styles.ctaIcon} />
      )}
    </>
  )

  if (cta.external) {
    return (
      <a
        href={cta.href}
        className={linkClassName}
        aria-label={label}
        target="_blank"
        rel="noreferrer"
      >
        {content}
      </a>
    )
  }

  return (
    <Link href={cta.href} className={linkClassName} aria-label={label}>
      {content}
    </Link>
  )
}
