"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { ROUTES } from "@/constants/routes"
import { useI18n } from "@/lib/i18n/client"


export function LandingEntry() {
  const { t } = useI18n()

  return <div className="landing-entry"><Link href={ROUTES.startChat} prefetch={false} className="nav-cta">{t("landing.start")}<ArrowUpRight size={16}/></Link><p>{t("landing.startHint")}</p></div>
}
