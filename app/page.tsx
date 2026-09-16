import type { Metadata } from "next"
import type { ReactElement } from "react"

import { ClosingCta } from "@/components/landing/closing-cta"
import { Hero } from "@/components/landing/hero"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingHeader } from "@/components/landing/landing-header"
import styles from "@/components/landing/landing.module.css"
import { ProductStatement } from "@/components/landing/product-statement"

export const metadata: Metadata = {
  title: "Thread Chat — 思考，允许分叉",
  description:
    "一个分支式 AI 对话工作台：划选回答中的任意内容，带着完整上下文开启分支，主线始终清晰，想法永不丢失。",
}

export default function LandingPage(): ReactElement {
  return (
    <div className={styles.page}>
      <LandingHeader />
      <main className={styles.main}>
        <Hero />
        <ProductStatement />
        <section
          className={styles.editorialSection}
          aria-labelledby="why-built-heading"
        >
          <h2 id="why-built-heading">为什么我要创建这个产品？</h2>
          <div className={styles.prose}>
            <p>
              我在学习 AI
              等复杂主题时，经常会在一条回复里遇到许多新的疑惑：一个概念没弄懂，想顺着它继续追问；刚看到一个关键词，又想换个方向查清楚。面对海量的信息和新概念，令人头疼。
            </p>
            <p>
              如果一直留在原对话里追问，等我想回到最初的问题时，中间已经堆满了各种延伸讨论。冗余的上下文会冲淡对话焦点，也占用上下文窗口，让
              AI 更难准确理解我此刻真正想问的是什么。
            </p>
            <p>
              现有的工具不能满足我的需求吗？是的。ChatGPT 和 Grok
              都提供了「创建新的聊天分叉」功能，但它们主要是从一条完整的 AI
              回复开始：ChatGPT 可以在新的回复上继续分叉，Grok
              则不能。对正在学习陌生领域的人来说，当一条回复里同时出现很多专业名词和关键词时，只能从整条回复开启分支，仍然不够细。Claude
              可以通过多次编辑用户消息来获得不同的回答，但只能编辑最近一条用户消息。
            </p>
            <p>
              这些方式都还无法满足我的真实需求：面对一条 AI
              回复里不断冒出的疑问，我想从任意一个具体概念、句子，甚至一个词开始追问，而且可以继续分叉，让每个想法都有自己的路径。我的思绪会不断跳到新的问题上，工具不应该要求我把它们硬塞回同一条对话里。
            </p>
            <p>
              所以我开始尝试一种新的交互：划选 AI
              回复中让我停下来的任意一段，带着完整上下文开出一条新的分支；主线继续保留，新的问题也有自己的位置。于是，Thread
              Chat 诞生了。
            </p>
          </div>
        </section>
        <section
          className={styles.editorialSection}
          aria-labelledby="why-not-existing-heading"
        >
          <h2 id="why-not-existing-heading">我是怎么解决的？</h2>
          <p className={styles.introduction}>
            我没有试图让一个聊天框容纳所有思路，核心就是升级现有交互为：划选内容、打开气泡、提问。把对话本身改成可以分叉的结构。
            <br />
            问题从哪里出现，就从哪里开始提问；主线保留，新的问题在新的分栏；新提问继承已有的上下文，大幅减少上下文的编写动作，少敲键盘。
          </p>
          <ol className={styles.differenceList}>
            <li>
              <span aria-hidden>01</span>
              <div>
                <h3>划选、提问、打开新的分栏继续对话</h3>
                <p>
                  划选一个概念、例子，甚至一个词，会自动出现提问气泡。输入问题就会打开新话题（Thread），并开启新分栏，不影响已有的聊天。
                </p>
              </div>
            </li>
            <li>
              <span aria-hidden>02</span>
              <div>
                <h3>自动继承上下文</h3>
                <p>
                  新分支继承这段内容之前的完整上下文。你不用复制粘贴，也不用重新向
                  AI 解释发生了什么。不用重复输入上下文。
                </p>
              </div>
            </li>
            <li>
              <span aria-hidden>03</span>
              <div>
                <h3>每一列聚焦一个话题</h3>
                <p>
                  新问题在独立分栏里继续。你可以深挖一个细节，而不会让原本的对话变成一串互不相关的追问。并在深入的话题中开启新话题，无限下去。就像人的思维一样。
                </p>
              </div>
            </li>
            <li>
              <span aria-hidden>04</span>
              <div>
                <h3>保持在无限的话题中不迷路</h3>
                <p>
                  我实现了「会话树」和「子分支树」让你可以快速的切换到任意一个聚焦话题。
                </p>
              </div>
            </li>
            <li>
              <span aria-hidden>05</span>
              <div>
                <h3>思维地图</h3>
                <p>
                  假设你聊了50个话题，最好的方式就是有一个思维地图，直接把所有的话题图示化。双击进入任意一个话题继续深入探讨。
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section
          className={styles.editorialSection}
          aria-labelledby="product-roadmap-heading"
        >
          <h2 id="product-roadmap-heading">Roadmap & TODOS</h2>
          <p className={styles.introduction}>
            Thread Chat
            会继续把分支对话做得更适合长期探索：更轻地携带上下文，更好地组织项目，也更容易把对话变成可以使用的成果。
          </p>
          <ol className={styles.roadmapList}>
            <li>
              <span aria-hidden>01</span>
              <div>
                <h3>更轻的上下文</h3>
                <p>
                  优化分支上下文的压缩，降低多列深入时的重复成本，让你可以放心探索更多方向。
                </p>
              </div>
            </li>
            <li>
              <span aria-hidden>02</span>
              <div>
                <h3>项目与记忆</h3>
                <p>
                  把目标、共享文档和话题记忆、长期记忆放进同一个研究空间，让每次对话都能接着上一次继续。
                </p>
              </div>
            </li>
            <li>
              <span aria-hidden>03</span>
              <div>
                <h3>研究与协作</h3>
                <p>
                  让对话可以搜索资料、总结重点、调用 Skill 和多个
                  Sub-agent，一起完成更复杂的研究任务。甚至总结话题结果后反哺父话题。
                </p>
              </div>
            </li>
            <li>
              <span aria-hidden>04</span>
              <div>
                <h3>内容与交互产物</h3>
                <p>
                  添加丰富的 Markdown、代码、图表、HTML
                  和交互式内容形态，让对话中更好地生成、预览和继续编辑。
                </p>
              </div>
            </li>
            <li>
              <span aria-hidden>05</span>
              <div>
                <h3>工作区体验</h3>
                <p>
                  更快地定位关键内容，更顺手地划选、导航和浏览，让多列和画布在不同设备上都好用。
                </p>
              </div>
            </li>
          </ol>
        </section>

        <ClosingCta />
      </main>
      <LandingFooter />
    </div>
  )
}
