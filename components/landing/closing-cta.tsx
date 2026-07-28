import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"

import { LandingCtaLink } from "./landing-cta-link"
import styles from "./landing.module.css"

export function ClosingCta(): ReactElement {
  return (
    <section className={styles.closing} aria-labelledby="closing-heading">
      <h2 id="closing-heading">Keep the question. Follow the branch.</h2>
      <p>
        Give the next interesting thought somewhere to go without leaving the one
        that brought you here.
      </p>
      <LandingCtaLink cta={LANDING.primaryCta} />
    </section>
  )
}
