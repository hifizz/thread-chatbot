import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"
import { cn } from "@/lib/utils"

import { LandingCtaLink } from "./landing-cta-link"
import styles from "./landing.module.css"
import type { LandingSectionProps } from "./types"

export function ClosingCta({ className }: LandingSectionProps): ReactElement {
  const { closing } = LANDING

  return (
    <section className={cn(styles.closing, className)}>
      <div className={styles.closingBranches} aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <h2>{closing.title}</h2>
      <p>{closing.description}</p>
      <div className={styles.closingActions}>
        <LandingCtaLink cta={closing.primaryCta} tone="primary" />
        <LandingCtaLink cta={closing.secondaryCta} tone="text" />
      </div>
    </section>
  )
}
