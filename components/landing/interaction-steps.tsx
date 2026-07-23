import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"
import { cn } from "@/lib/utils"

import styles from "./landing.module.css"
import type { LandingSectionProps } from "./types"

export function InteractionSteps({
  className,
}: LandingSectionProps): ReactElement {
  return (
    <section
      id="how-it-works"
      className={cn(styles.section, className)}
      aria-labelledby="interaction-heading"
    >
      <div className={styles.sectionHeading}>
        <p className={styles.sectionIndex}>
          {LANDING.steps[0].number} / {LANDING.nav[0].label}
        </p>
        <h2 id="interaction-heading" className={styles.sectionTitle}>
          {LANDING.steps.map((step) => step.verb).join(". ")}.
        </h2>
      </div>

      <ol className={styles.stepsList}>
        {LANDING.steps.map((step, index) => (
          <li className={styles.step} key={step.number}>
            <div className={styles.stepTopline}>
              <span className={styles.stepNumber}>{step.number}</span>
              <span className={styles.stepVerb}>{step.verb}</span>
            </div>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
            {index < LANDING.steps.length - 1 ? (
              <span className={styles.stepConnector} aria-hidden>
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}
