import type { Metadata } from "next"
import type { ReactElement } from "react"

import { CanvasShowcase } from "@/components/landing/canvas-showcase"
import { ClosingCta } from "@/components/landing/closing-cta"
import { CapabilityGrid } from "@/components/landing/feature-grid"
import { Hero } from "@/components/landing/hero"
import { InteractionSteps } from "@/components/landing/interaction-steps"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingHeader } from "@/components/landing/landing-header"
import styles from "@/components/landing/landing.module.css"
import { WorkspaceShowcase } from "@/components/landing/workspace-showcase"

export const metadata: Metadata = {
  title: "Thread Chat — Branch your AI conversations",
  description:
    "Select any part of an AI response, branch from that exact point, and navigate the full conversation as columns or a canvas.",
}

export default function LandingPage(): ReactElement {
  return (
    <div className={styles.page}>
      <LandingHeader />
      <main>
        <div className={styles.shell}>
          <Hero />
          <InteractionSteps />
          <WorkspaceShowcase />
          <CanvasShowcase />
          <CapabilityGrid />
          <ClosingCta />
        </div>
      </main>
      <LandingFooter />
    </div>
  )
}
