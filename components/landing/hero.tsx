import type { ReactElement } from "react"

import styles from "./landing.module.css"

export function Hero(): ReactElement {
  return (
    <section className={styles.hero} aria-labelledby="hero-slogan">
      <figure className={styles.videoFrame}>
        <div className={styles.videoFallback} aria-hidden>
          <span className={styles.fallbackBranch} />
          <span className={styles.fallbackBranch} />
          <span className={styles.fallbackBranch} />
        </div>
        {/* 视频资源就绪后替换 public/thread-chat-hero.mp4 即可，外壳无需改动 */}
        <video
          className={styles.heroVideo}
          src="/thread-chat-hero.mp4"
          aria-label="Thread Chat 预览：划选回答中的一句话，在主对话旁开启一条相连的分支。"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
        >
          Thread Chat 预览：划选回答中的一句话，在主对话旁开启一条相连的分支。
        </video>
        <figcaption id="hero-slogan" className={styles.heroSlogan}>
          思考，允许分叉。
        </figcaption>
      </figure>
    </section>
  )
}
