import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"

import styles from "./landing.module.css"

export function ProductStatement(): ReactElement {
  const { statement } = LANDING

  return (
    <section className={styles.statement} aria-labelledby="statement-heading">
      <h1 id="statement-heading">{statement.title}</h1>
      <p>{statement.description}</p>
    </section>
  )
}
