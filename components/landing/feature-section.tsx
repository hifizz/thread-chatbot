import type { ReactElement } from "react"

import { LANDING_COPY } from "@/constants/landing"

import styles from "./landing.module.css"

export function FeatureSection(): ReactElement {
  return (
    <section
      className={styles.editorialSection}
      aria-labelledby="features-heading"
    >
      <h2 id="features-heading" className={styles.sectionTitle}>
        {LANDING_COPY.features.heading}
      </h2>
      <ul className={styles.featureList}>
        {LANDING_COPY.features.items.map((item, i) => (
          <li key={item.title}>
            <span aria-hidden>{String(i + 1).padStart(2, "0")}</span>
            <div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
