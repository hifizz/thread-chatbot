import type { LandingCta } from "@/constants/landing"

export interface LandingSectionProps {
  className?: string
}

export interface LandingCtaLinkProps {
  cta: LandingCta
  tone: "primary" | "secondary" | "text"
  className?: string
}
