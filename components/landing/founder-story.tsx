import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"

import styles from "./landing.module.css"

export function FounderStory(): ReactElement {
  const { whyBuilt } = LANDING

  return (
    <section className={styles.editorialSection} aria-labelledby="why-built-heading">
      <h2 id="why-built-heading">{whyBuilt.title}</h2>
      <div className={styles.prose}>
        {whyBuilt.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </section>
  )
}
