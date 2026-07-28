import Link from "next/link"
import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"
import { PROJECT } from "@/constants/project"

import styles from "./landing.module.css"

export function LandingFooter(): ReactElement {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div>
          <p>{LANDING.footer.line}</p>
        </div>
        <nav aria-label="Footer navigation">
          <ul className={styles.footerLinks}>
            {LANDING.footer.links.map((link) => (
              <li key={link.href}>
                {link.external ? (
                  <a href={link.href} target="_blank" rel="noreferrer">
                    {link.label}
                  </a>
                ) : (
                  <Link href={link.href}>{link.label}</Link>
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
