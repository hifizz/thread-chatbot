import {
  Database,
  FileText,
  MessagesSquare,
  Search,
  type LucideIcon,
} from "lucide-react"
import type { ReactElement } from "react"

import { LANDING, type LandingCapabilityIcon } from "@/constants/landing"
import { cn } from "@/lib/utils"

import styles from "./landing.module.css"
import type { LandingSectionProps } from "./types"

const ICONS: Record<LandingCapabilityIcon, LucideIcon> = {
  messages: MessagesSquare,
  database: Database,
  fileText: FileText,
  search: Search,
}

export function CapabilityGrid({
  className,
}: LandingSectionProps): ReactElement {
  return (
    <section
      id="capabilities"
      className={cn(styles.section, styles.capabilitySection, className)}
      aria-labelledby="capabilities-heading"
    >
      <div className={styles.capabilityHeading}>
        <h2 id="capabilities-heading" className={styles.sectionTitle}>
          {LANDING.capabilitiesTitle}
        </h2>
      </div>

      <div className={styles.capabilityGrid}>
        {LANDING.capabilities.map((capability, index) => {
          const Icon = ICONS[capability.icon]

          return (
            <article className={styles.capabilityCard} key={capability.title}>
              <div className={styles.capabilityTopline}>
                <span className={styles.capabilityIcon}>
                  <Icon aria-hidden />
                </span>
                <span className={styles.capabilityIndex} aria-hidden>
                  0{index + 1}
                </span>
              </div>
              <h3>{capability.title}</h3>
              <p>{capability.description}</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
