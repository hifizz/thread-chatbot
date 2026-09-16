import type { ReactElement } from "react"

import { ROUTES } from "@/constants/routes"

import { LandingCtaLink } from "./landing-cta-link"
import styles from "./landing.module.css"

export function ClosingCta(): ReactElement {
  return (
    <section className={styles.closing} aria-labelledby="closing-heading">
      <h2 id="closing-heading">工具释放自由</h2>
      <p>当脑海中有了新的疑惑，随时随地在任意位置划选内容，开启新对话。</p>
      <LandingCtaLink cta={{ label: "立刻开始", href: ROUTES.startChat }} />
    </section>
  )
}
