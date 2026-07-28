import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"

import styles from "./landing.module.css"

export function WhyNotExistingTools(): ReactElement {
  const { whyNotExisting } = LANDING

  return (
    <section
      className={styles.editorialSection}
      aria-labelledby="why-not-existing-heading"
    >
      <h2 id="why-not-existing-heading">{whyNotExisting.title}</h2>
      <p className={styles.introduction}>{whyNotExisting.introduction}</p>
      <ol className={styles.differenceList}>
        {whyNotExisting.differences.map((difference, index) => (
          <li key={difference.title}>
            <span aria-hidden>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h3>{difference.title}</h3>
              <p>{difference.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
