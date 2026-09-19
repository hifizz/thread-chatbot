import type { ReactElement } from "react"

import { LANDING_COPY } from "@/constants/landing"
import { ROUTES } from "@/constants/routes"

import { LandingCtaLink } from "./landing-cta-link"
import styles from "./landing.module.css"

export function Hero(): ReactElement {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <h1 id="hero-title" className={styles.heroTitle}>
        {LANDING_COPY.hero.title}
      </h1>
      <p className={styles.heroSubtitle}>{LANDING_COPY.hero.subtitle}</p>
      <div className={styles.ctaRow}>
        <LandingCtaLink
          cta={{ label: LANDING_COPY.hero.cta, href: ROUTES.startChat }}
        />
      </div>
    </section>
  )
}
