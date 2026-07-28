// Homepage copy, routes, and replaceable media live here so sections stay presentational.

import { PROJECT } from "./project"
import { ROUTES } from "./routes"

export interface LandingCta {
  label: string
  href: string
  accessibleLabel?: string
}

export interface LandingContent {
  hero: {
    videoSrc: string
    videoDescription: string
    slogan: string
  }
  statement: {
    title: string
    description: string
  }
  whyBuilt: {
    title: string
    paragraphs: readonly string[]
  }
  whyNotExisting: {
    title: string
    introduction: string
    differences: readonly { title: string; description: string }[]
  }
  navCta: LandingCta
  primaryCta: LandingCta
  footer: {
    line: string
    links: readonly { label: string; href: string; external?: boolean }[]
  }
}

export const LANDING: LandingContent = {
  hero: {
    // Replace this file when the final MP4 is ready. The visual shell works without it.
    videoSrc: "/thread-chat-hero.mp4",
    videoDescription:
      "A preview of Thread Chat, where a selected answer opens a connected branch beside the main conversation.",
    slogan: "Your thoughts are allowed to branch.",
  },
  statement: {
    title: "Think past the first answer.",
    description:
      "A workspace for following the interesting parts of an AI conversation without losing the original thread.",
  },
  whyBuilt: {
    title: "A good question rarely moves in a straight line.",
    paragraphs: [
      "Most chat interfaces are designed to keep moving forward. But the useful part of a conversation often begins when one sentence makes you pause, question it, and take a different path.",
      "Opening a new chat loses the moment that made the question matter. Staying in the same one turns the original line of thought into noise. I wanted both paths to remain visible.",
    ],
  },
  whyNotExisting: {
    title: "A branch is not yet a thinking structure.",
    introduction:
      "ChatGPT and Codex can open threads or branches. Thread Chat is built around what happens after the split: keeping the relationship between ideas intact as you keep exploring.",
    differences: [
      {
        title: "Start from the exact thought",
        description:
          "Every branch inherits the conversation at the sentence you selected, so the question starts with the context that made it meaningful.",
      },
      {
        title: "Keep the main line clear",
        description:
          "A branch develops beside the original conversation. You can go deep without turning the main thread into a transcript of detours.",
      },
      {
        title: "Return to the whole shape",
        description:
          "Your tree and workspace persist across visits, and a useful branch can become a Markdown artifact without losing where it came from.",
      },
    ],
  },
  navCta: {
    label: "Get started",
    href: ROUTES.startChat,
  },
  primaryCta: {
    label: "Follow your next question",
    href: ROUTES.startChat,
  },
  footer: {
    line: "Built for curiosity with a long memory.",
    links: [
      { label: "GitHub", href: PROJECT.repositoryUrl, external: true },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
}
