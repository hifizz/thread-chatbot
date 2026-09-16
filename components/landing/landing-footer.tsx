import Link from "next/link"
import type { ReactElement } from "react"

import { PROJECT } from "@/constants/project"

import styles from "./landing.module.css"

export function LandingFooter(): ReactElement {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div>
          <p>应当像人思考一样使用 AI</p>
        </div>
        <nav aria-label="页脚导航">
          <ul className={styles.footerLinks}>
            <li>
              <a href={PROJECT.repositoryUrl} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </li>
            <li>
              <Link href="/privacy">隐私政策</Link>
            </li>
            <li>
              <Link href="/terms">服务条款</Link>
            </li>
          </ul>
        </nav>
        <p className={styles.footerCopyright}>
          © {PROJECT.copyrightYear} {PROJECT.copyrightHolder}
        </p>
      </div>
    </footer>
  )
}
