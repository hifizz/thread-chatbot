/** 落地页 CTA 链接的最小契约：label/href 必填，可选无障碍标签。 */
export interface LandingCta {
  label: string
  href: string
  accessibleLabel?: string
}

export interface LandingSectionProps {
  className?: string
}

export interface LandingCtaLinkProps {
  cta: LandingCta
  className?: string
}
