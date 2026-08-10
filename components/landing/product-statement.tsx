import type { ReactElement } from "react"

import { PROJECT } from "@/constants/project"
import { ROUTES } from "@/constants/routes"

import { LandingCtaLink } from "./landing-cta-link"
import styles from "./landing.module.css"

export function ProductStatement(): ReactElement {
  return (
    <section className={styles.statement} aria-labelledby="statement-heading">
      <h1 id="statement-heading" className="font mb-6 text-5xl">
        {/*在任意一句话上，岔开一条新思路*/}
        像人类思考一样对话
      </h1>
      <p className="text-xl leading-[1.6] font-light">
        划选回答中的任意内容，即可带着完整上下文开启新对话
        <br /> 线性对话升级到网状对话，就像人类的思考方式一样
      </p>
      <div className={styles.ctaRow}>
        <LandingCtaLink
          cta={{ label: "立刻免费开始", href: ROUTES.startChat }}
        />
        <a
          href={PROJECT.repositoryUrl}
          className={styles.ctaLinkSecondary}
          target="_blank"
          rel="noreferrer"
          aria-label="在 GitHub 上查看 Thread Chat 源码"
        >
          <svg
            aria-hidden
            height={32}
            width={32}
            viewBox="0 0 16 16"
            fill="currentColor"
            className={styles.ctaIcon}
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.22.48-2.69-.96-2.69-.96-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span>GitHub</span>
        </a>
      </div>
    </section>
  )
}
