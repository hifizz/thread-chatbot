import Image from "next/image"
import Link from "next/link"
import type { ReactElement } from "react"

import { LANDING_COPY } from "@/constants/landing"
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
          aria-label={`${PROJECT.name} 首页`}
        >
          <Image
            src="/favicon.ico"
            alt=""
            width={26}
            height={26}
            className={styles.brandLogo}
            preload
          />
          <span className={styles.brandName}>{PROJECT.name}</span>
        </Link>
        <nav className={styles.headerNav} aria-label="页内导航">
          <a href="#scenarios">{LANDING_COPY.nav.scenarios}</a>
          <a href="#faq">{LANDING_COPY.nav.faq}</a>
        </nav>
        <LandingCtaLink
          cta={{ label: LANDING_COPY.nav.cta, href: ROUTES.startChat }}
          className={styles.headerCta}
        />
      </div>
    </header>
  )
}
