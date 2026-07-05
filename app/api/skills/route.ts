import { NextResponse } from "next/server"
import { getSkillMetas } from "@/lib/skills/registry"

export async function GET() {
  return NextResponse.json(getSkillMetas())
}
