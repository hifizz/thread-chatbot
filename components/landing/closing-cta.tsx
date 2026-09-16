import type { ReactElement } from "react"

import { LANDING_COPY } from "@/constants/landing"
import { ROUTES } from "@/constants/routes"

import { LandingCtaLink } from "./landing-cta-link"
import styles from "./landing.module.css"

export function ClosingCta(): ReactElement {
  return (
    <section className={styles.closing} aria-labelledby="closing-heading">
      <h2 id="closing-heading">{LANDING_COPY.closing.heading}</h2>
      <p>{LANDING_COPY.closing.body}</p>
      <LandingCtaLink
        cta={{ label: LANDING_COPY.closing.cta, href: ROUTES.startChat }}
      />
    </section>
  )
}
