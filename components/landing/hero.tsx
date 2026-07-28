import type { ReactElement } from "react"

import { LANDING } from "@/constants/landing"

import styles from "./landing.module.css"

export function Hero(): ReactElement {
  const { hero } = LANDING

  return (
    <section className={styles.hero} aria-labelledby="hero-slogan">
      <figure className={styles.videoFrame}>
        <div className={styles.videoFallback} aria-hidden>
          <span className={styles.fallbackBranch} />
          <span className={styles.fallbackBranch} />
          <span className={styles.fallbackBranch} />
        </div>
        <video
          className={styles.heroVideo}
          src={hero.videoSrc}
          aria-label={hero.videoDescription}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
        >
          {hero.videoDescription}
        </video>
        <figcaption id="hero-slogan" className={styles.heroSlogan}>
          {hero.slogan}
        </figcaption>
      </figure>
    </section>
  )
}
