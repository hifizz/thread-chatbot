import { ChevronRight, Columns3, GitBranch } from "lucide-react"
import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"
import { cn } from "@/lib/utils"

import styles from "./landing.module.css"
import type { LandingSectionProps } from "./types"

export function WorkspaceShowcase({
  className,
}: LandingSectionProps): ReactElement {
  const { workspace, steps } = LANDING

  return (
    <section
      id={workspace.id}
      className={cn(styles.section, styles.showcaseSection, className)}
      aria-labelledby="workspace-heading"
    >
      <div className={styles.showcaseCopy}>
        <p className={styles.sectionIndex}>
          {steps[1].number} / {workspace.eyebrow}
        </p>
        <h2 id="workspace-heading" className={styles.sectionTitle}>
          {workspace.title}
        </h2>
        <p className={styles.sectionDescription}>{workspace.description}</p>
        <ul className={styles.noteList}>
          {workspace.notes.map((note, index) => (
            <li key={note}>
              <span aria-hidden>0{index + 1}</span>
              {note}
            </li>
          ))}
        </ul>
      </div>

      <figure className={styles.workspaceFigure}>
        <figcaption className={styles.srOnly}>
          {workspace.description}
        </figcaption>
        <div className={styles.workspaceToolbar}>
          <div className={styles.workspacePath}>
            <Columns3 aria-hidden />
            {steps.map((step) => (
              <span key={step.number}>
                <ChevronRight aria-hidden />
                {step.verb}
              </span>
            ))}
          </div>
          <span className={styles.workspaceStatus}>
            <span aria-hidden />
            {workspace.notes[0]}
          </span>
        </div>
        <div className={styles.columns}>
          {steps.map((step, index) => (
            <article
              className={cn(styles.column, index === 1 && styles.columnActive)}
              key={step.number}
            >
              <div className={styles.columnHeader}>
                <span>{step.number}</span>
                <GitBranch aria-hidden />
              </div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
              <div className={styles.textLines} aria-hidden>
                <span />
                <span />
                <span />
              </div>
            </article>
          ))}
        </div>
      </figure>
    </section>
  )
}
