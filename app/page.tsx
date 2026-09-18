import type { Metadata } from "next"
import Landing from "@/components/landing/landing"
import BetaWaitlistPage from "@/app/beta/page"
import { BETA_ACCESS_ENFORCED } from "@/constants/beta-access"
import "@/components/landing/landing.css"

export const metadata: Metadata = BETA_ACCESS_ENFORCED
  ? {
      title: "ThreadChat 私测申请",
      description: "申请 ThreadChat Private Beta 访问资格。",
    }
  : {
      title: "ThreadChat · 一款能开分叉的 AI",
      description:
        "做调研、写方案、学知识：带着背景开启分支，分栏并排阅读，分支树找回讨论，再把有用的结论带回主线。",
    }

export default function LandingPage() {
  if (BETA_ACCESS_ENFORCED) return <BetaWaitlistPage />
  return <Landing />
}
