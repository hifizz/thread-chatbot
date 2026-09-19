import type { ReactElement } from "react"

import { LANDING_COPY } from "@/constants/landing"

import styles from "./landing.module.css"

export function FaqSection(): ReactElement {
  return (
    <section
      id="faq"
      className={styles.editorialSection}
      aria-labelledby="faq-heading"
    >
      <h2 id="faq-heading" className={styles.sectionTitle}>
        {LANDING_COPY.faq.heading}
      </h2>
      <div className={styles.faqList}>
        {LANDING_COPY.faq.items.map((item) => (
          <details key={item.q} className={styles.faqItem}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
