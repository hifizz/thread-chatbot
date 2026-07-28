import type { Metadata } from "next"
import type { ReactElement } from "react"

import { ClosingCta } from "@/components/landing/closing-cta"
import { FounderStory } from "@/components/landing/founder-story"
import { Hero } from "@/components/landing/hero"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingHeader } from "@/components/landing/landing-header"
import styles from "@/components/landing/landing.module.css"
import { ProductStatement } from "@/components/landing/product-statement"
import { WhyNotExistingTools } from "@/components/landing/why-not-existing-tools"

export const metadata: Metadata = {
  title: "Thread Chat — Think past the first answer",
  description:
    "A workspace for following the interesting parts of an AI conversation without losing the original thread.",
}

export default function LandingPage(): ReactElement {
  return (
    <div className={styles.page}>
      <LandingHeader />
      <main className={styles.main}>
        <Hero />
        <ProductStatement />
        <FounderStory />
        <WhyNotExistingTools />
        <ClosingCta />
      </main>
      <LandingFooter />
    </div>
  )
}
