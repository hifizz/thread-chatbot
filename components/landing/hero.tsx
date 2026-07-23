import { CornerDownRight, MousePointer2 } from "lucide-react"
import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"
import { cn } from "@/lib/utils"

import { LandingCtaLink } from "./landing-cta-link"
import styles from "./landing.module.css"
import type { LandingSectionProps } from "./types"

export function Hero({ className }: LandingSectionProps): ReactElement {
  const { hero, steps } = LANDING

  return (
    <section className={cn(styles.hero, className)}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>
          <span className={styles.eyebrowRule} aria-hidden />
          {hero.eyebrow}
        </p>
        <h1 className={styles.heroTitle}>{hero.title}</h1>
        <p className={styles.heroSubtitle}>{hero.subtitle}</p>
        <div className={styles.heroActions}>
          <LandingCtaLink cta={hero.primaryCta} tone="primary" />
          <LandingCtaLink cta={hero.secondaryCta} tone="secondary" />
        </div>
        <p className={styles.marginNote}>
          <span aria-hidden>01</span>
          {steps[1].description}
        </p>
      </div>

      <figure className={styles.heroFigure}>
        <figcaption className={styles.srOnly}>
          {steps[0].description} {steps[1].description}
        </figcaption>
        <div className={styles.notebookMeta} aria-hidden>
          <span />
          <span />
          <span />
          <p>{steps[0].number}</p>
        </div>
        <article className={styles.mainThreadCard}>
          <p className={styles.cardKicker}>{steps[0].title}</p>
          <p className={styles.responseText}>
            {hero.subtitle}
            <mark className={styles.selection}>
              <MousePointer2 aria-hidden />
              {steps[0].verb}
            </mark>
          </p>
        </article>
        <div className={styles.branchConnector} aria-hidden>
          <CornerDownRight />
        </div>
        <article className={styles.branchCard}>
          <span className={styles.branchDepth} aria-hidden />
          <div>
            <p className={styles.cardKicker}>
              {steps[1].number} · {steps[1].verb}
            </p>
            <p>{steps[1].title}</p>
          </div>
        </article>
        <aside className={styles.figureAnnotation}>
          <span aria-hidden>↳</span>
          {steps[2].title}
        </aside>
      </figure>
    </section>
  )
}
