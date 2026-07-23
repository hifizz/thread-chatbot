// English landing-page content and its rendering contracts.
// Components own presentation only; product copy and destinations stay here.

import { PROJECT } from "./project"
import { ROUTES } from "./routes"

export type LandingSectionId =
  "how-it-works" | "workspace" | "canvas" | "capabilities"

export interface LandingNavItem {
  label: string
  href: `#${LandingSectionId}` | string
  external?: boolean
}

export interface LandingCta {
  label: string
  href: string
  external?: boolean
  accessibleLabel?: string
}

export interface LandingHeroContent {
  eyebrow: string
  title: string
  subtitle: string
  primaryCta: LandingCta
  secondaryCta: LandingCta
}

export interface LandingStep {
  number: "01" | "02" | "03"
  verb: "Select" | "Branch" | "Navigate"
  title: string
  description: string
}

export interface LandingShowcaseContent {
  id: Extract<LandingSectionId, "workspace" | "canvas">
  eyebrow: string
  title: string
  description: string
  notes: readonly string[]
}

export type LandingCapabilityIcon =
  "messages" | "database" | "fileText" | "search"

export interface LandingCapability {
  icon: LandingCapabilityIcon
  title: string
  description: string
}

export interface LandingContent {
  nav: readonly LandingNavItem[]
  hero: LandingHeroContent
  steps: readonly LandingStep[]
  workspace: LandingShowcaseContent
  canvas: LandingShowcaseContent
  capabilitiesTitle: string
  capabilities: readonly LandingCapability[]
  closing: {
    title: string
    description: string
    primaryCta: LandingCta
    secondaryCta: LandingCta
  }
}

const startChatCta: LandingCta = {
  label: "Start chatting",
  href: ROUTES.startChat,
}

const githubCta: LandingCta = {
  label: "View on GitHub",
  href: PROJECT.repositoryUrl,
  external: true,
}

export const LANDING: LandingContent = {
  nav: [
    { label: "How it works", href: "#how-it-works" },
    { label: "Workspace", href: "#workspace" },
    { label: "Canvas", href: "#canvas" },
    {
      label: "GitHub",
      href: PROJECT.repositoryUrl,
      external: true,
    },
  ],
  hero: {
    eyebrow: "A thinking interface for AI",
    title: "Follow every thought. Lose none of the thread.",
    subtitle:
      "Select any part of an AI response and open a focused conversation from that exact point. Every branch keeps its context, while your main line stays intact.",
    primaryCta: startChatCta,
    secondaryCta: githubCta,
  },
  steps: [
    {
      number: "01",
      verb: "Select",
      title: "Start where curiosity strikes",
      description:
        "Highlight a phrase, claim, or example inside any AI response. The point you selected becomes the focus of a new conversation.",
    },
    {
      number: "02",
      verb: "Branch",
      title: "Carry context, not clutter",
      description:
        "The branch inherits everything up to the fork, then develops independently. Your original conversation remains clean and readable.",
    },
    {
      number: "03",
      verb: "Navigate",
      title: "Compare, return, and go deeper",
      description:
        "Move through breadcrumbs, side-by-side columns, or the full canvas. A branch can split again whenever the next question appears.",
    },
  ],
  workspace: {
    id: "workspace",
    eyebrow: "Side-by-side workspace",
    title: "Compare ideas without losing your place.",
    description:
      "Keep the main thread anchored while opening important branches beside it. Compare ideas side by side, then return without losing your place.",
    notes: [
      "Each branch inherits its context",
      "Resizable reading columns",
      "Breadcrumbs, search, and quick switching",
    ],
  },
  canvas: {
    id: "canvas",
    eyebrow: "Conversation canvas",
    title: "See the shape of your thinking.",
    description:
      "Zoom out from individual messages to the entire conversation tree. Find the path you took, spot parallel ideas, and jump back into any node.",
    notes: [
      "See every conversation at a glance",
      "Pan, zoom, pin, and rearrange",
      "Continue the discussion from the map",
    ],
  },
  capabilitiesTitle: "Built for ideas that branch.",
  capabilities: [
    {
      icon: "messages",
      title: "Context-aware branches",
      description:
        "Every branch inherits the conversation up to the selected point, then develops independently.",
    },
    {
      icon: "database",
      title: "Persistent conversation trees",
      description:
        "Your branches and messages stay where you left them, across refreshes and return visits.",
    },
    {
      icon: "fileText",
      title: "Markdown artifacts",
      description:
        "Turn any branch into a structured Markdown document and keep it linked to the conversation that produced it.",
    },
    {
      icon: "search",
      title: "Deep research",
      description:
        "Search the web, read relevant pages, and keep source-backed findings inside the conversation tree.",
    },
  ],
  closing: {
    title: "Give every good question room to grow.",
    description:
      "Start with one conversation. Follow the interesting parts. Return with the whole line of thought still in view.",
    primaryCta: startChatCta,
    secondaryCta: githubCta,
  },
}
