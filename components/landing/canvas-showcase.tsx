import { Maximize2, Minus, Plus } from "lucide-react"
import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"
import { cn } from "@/lib/utils"

import styles from "./landing.module.css"
import type { LandingSectionProps } from "./types"

export function CanvasShowcase({
  className,
}: LandingSectionProps): ReactElement {
  const { canvas, steps } = LANDING

  return (
    <section
      id={canvas.id}
      className={cn(
        styles.section,
        styles.showcaseSection,
        styles.canvasSection,
        className
      )}
      aria-labelledby="canvas-heading"
    >
      <figure className={styles.canvasFigure}>
        <figcaption className={styles.srOnly}>{canvas.description}</figcaption>
        <div className={styles.canvasGrid} aria-hidden />
        <div className={styles.canvasControls} aria-hidden>
          <span>
            <Minus />
          </span>
          <span>
            <Plus />
          </span>
          <span>
            <Maximize2 />
          </span>
        </div>
        <div className={styles.canvasTree}>
          <div className={styles.treeStem} aria-hidden />
          <article className={cn(styles.canvasNode, styles.canvasNodeRoot)}>
            <span>{steps[0].number}</span>
            <h3>{steps[0].title}</h3>
          </article>
          <article className={cn(styles.canvasNode, styles.canvasNodeFocus)}>
            <span>{steps[1].number}</span>
            <h3>{steps[1].title}</h3>
          </article>
          <article className={cn(styles.canvasNode, styles.canvasNodeReturn)}>
            <span>{steps[2].number}</span>
            <h3>{steps[2].title}</h3>
          </article>
          <article className={cn(styles.canvasNode, styles.canvasNodeDeep)}>
            <span>04</span>
            <h3>{canvas.notes[2]}</h3>
          </article>
        </div>
        <p className={styles.canvasLegend}>
          <span aria-hidden />
          {canvas.notes[0]}
        </p>
      </figure>

      <div className={styles.showcaseCopy}>
        <p className={styles.sectionIndex}>
          {steps[2].number} / {canvas.eyebrow}
        </p>
        <h2 id="canvas-heading" className={styles.sectionTitle}>
          {canvas.title}
        </h2>
        <p className={styles.sectionDescription}>{canvas.description}</p>
        <ul className={styles.noteList}>
          {canvas.notes.map((note, index) => (
            <li key={note}>
              <span aria-hidden>0{index + 1}</span>
              {note}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
