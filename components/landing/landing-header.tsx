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
            <span />
            <span />
            <span />
          </span>
          <span>{PROJECT.name}</span>
        </Link>

        <nav className={styles.nav} aria-label="Primary navigation">
          <ul className={styles.navList}>
            {LANDING.nav.map((item) => (
              <li key={item.href}>
                {item.external ? (
                  <a
                    href={item.href}
                    className={styles.navLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link href={item.href} className={styles.navLink}>
                    {item.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <LandingCtaLink
          cta={LANDING.hero.primaryCta}
          tone="primary"
          className={styles.headerCta}
        />
      </div>
    </header>
  )
}
