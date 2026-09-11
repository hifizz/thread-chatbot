import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { ROUTES } from "@/constants/routes"

export function LandingEntry() {
  return <div className="landing-entry"><Link href={ROUTES.startChat} prefetch={false} className="nav-cta">开始使用<ArrowUpRight size={16}/></Link><p>带一个正在做的问题，开始你的第一次探索。</p></div>
}
