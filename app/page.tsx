import type { Metadata } from "next"
import type { ReactElement } from "react"

import { ClosingCta } from "@/components/landing/closing-cta"
import { FaqSection } from "@/components/landing/faq-section"
import { FeatureSection } from "@/components/landing/feature-section"
import { Hero } from "@/components/landing/hero"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingHeader } from "@/components/landing/landing-header"
import { ScenarioDemo } from "@/components/landing/scenario-demo"
import styles from "@/components/landing/landing.module.css"
import "@/components/landing/landing-demo.css"
import { LANDING_COPY } from "@/constants/landing"

export const metadata: Metadata = {
  title: "Thread Chat — 一款能开分叉的 AI",
  description:
    "做调研、写方案、学知识：从一句话开启分支，继承上下文深入讨论，在子话题继续开启分支，直到心中的问题都被解答。",
}

export default function LandingPage(): ReactElement {
  return (
    <div className={styles.page}>
      <LandingHeader />
      <main className={styles.main}>
        <Hero />
        <section
          id="scenarios"
          className={styles.demoSection}
          aria-labelledby="demo-heading"
        >
          <h2 id="demo-heading" className={styles.sectionTitle}>
            {LANDING_COPY.demo.heading}
          </h2>
          <p className={styles.sectionIntro}>{LANDING_COPY.demo.intro}</p>
          <ScenarioDemo />
        </section>
        <FeatureSection />
        <FaqSection />
        <ClosingCta />
      </main>
      <LandingFooter />
    </div>
  )
}
