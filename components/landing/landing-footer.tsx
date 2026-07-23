import Link from "next/link"
import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"
import { PROJECT } from "@/constants/project"
import { ROUTES } from "@/constants/routes"

import styles from "./landing.module.css"

export function LandingFooter(): ReactElement {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <Link href={ROUTES.landing} className={styles.footerBrand}>
          <span className={styles.footerMark} aria-hidden />
          {PROJECT.name}
        </Link>
        <nav aria-label="Footer navigation">
          <ul className={styles.footerLinks}>
            {LANDING.nav.map((item) => (
              <li key={item.href}>
                {item.external ? (
                  <a href={item.href} target="_blank" rel="noreferrer">
                    {item.label}
                  </a>
                ) : (
                  <Link href={item.href}>{item.label}</Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <p className={styles.footerCopyright}>
          © {PROJECT.copyrightYear} {PROJECT.copyrightHolder}
        </p>
      </div>
    </footer>
  )
}
