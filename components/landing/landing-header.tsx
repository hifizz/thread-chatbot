import Link from "next/link"
import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"
import { PROJECT } from "@/constants/project"
import { ROUTES } from "@/constants/routes"

import { LandingCtaLink } from "./landing-cta-link"
import styles from "./landing.module.css"

export function LandingHeader(): ReactElement {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link
          href={ROUTES.landing}
          className={styles.brand}
          aria-label={`${PROJECT.name} home`}
        >
          <span className={styles.brandMark} aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </Link>
        <LandingCtaLink cta={LANDING.navCta} className={styles.headerCta} />
      </div>
    </header>
  )
}
