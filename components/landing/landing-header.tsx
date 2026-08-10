import Image from "next/image"
import Link from "next/link"
import type { ReactElement } from "react"

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
        </Link>
        <LandingCtaLink
          cta={{ label: "立刻开始", href: ROUTES.startChat }}
          className={styles.headerCta}
        />
      </div>
    </header>
  )
}
