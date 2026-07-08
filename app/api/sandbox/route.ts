import { NextResponse } from "next/server"
import {
  applyFiles,
  destroySandbox,
  ensureSandbox,
  getBuildState,
  getSandbox,
  imageReady,
  isAvailable,
  probeReady,
  sandboxLogs,
  sandboxName,
  startImageBuild,
} from "@/lib/sandbox/manager"

// 容器沙箱（Apple container，实验特性）的控制面。
// GET: 环境探测；POST: ensure / apply / status / destroy / build 五个动作。

export const maxDuration = 240

export async function GET() {
  const available = await isAvailable()
  const build = getBuildState()
  return NextResponse.json({
    available,
    imageReady: available ? await imageReady() : false,
    building: build.building,
    buildError: build.error,
    buildLog: build.log.slice(-2000),
  })
}

type PostBody = {
  action: "ensure" | "apply" | "status" | "destroy" | "build"
  artifactId?: string
  files?: { path: string; content: string }[]
}

export async function POST(req: Request) {
  let body: PostBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  try {
    switch (body.action) {
      case "build": {
        const state = startImageBuild()
        return NextResponse.json({
          building: state.building,
          buildError: state.error,
        })
      }
      case "ensure": {
        if (!body.artifactId)
          return NextResponse.json(
            { error: "缺少 artifactId" },
            { status: 400 }
          )
        if (!(await imageReady())) {
          return NextResponse.json({ error: "IMAGE_MISSING" }, { status: 409 })
        }
        const info = await ensureSandbox(body.artifactId)
        if (body.files?.length) await applyFiles(body.artifactId, body.files)
        return NextResponse.json(info)
      }
      case "apply": {
        if (!body.artifactId || !body.files?.length) {
          return NextResponse.json(
            { error: "缺少 artifactId 或 files" },
            { status: 400 }
          )
        }
        const result = await applyFiles(body.artifactId, body.files)
        return NextResponse.json(result)
      }
      case "status": {
        if (!body.artifactId)
          return NextResponse.json(
            { error: "缺少 artifactId" },
            { status: 400 }
          )
        const info = await getSandbox(sandboxName(body.artifactId))
        if (!info)
          return NextResponse.json({ running: false, ready: false, url: null })
        const ready = info.url ? await probeReady(info.url) : false
        return NextResponse.json({
          ...info,
          ready,
          logs: ready ? undefined : await sandboxLogs(info.name, 20),
        })
      }
      case "destroy": {
        if (!body.artifactId)
          return NextResponse.json(
            { error: "缺少 artifactId" },
            { status: 400 }
          )
        await destroySandbox(body.artifactId)
        return NextResponse.json({ ok: true })
      }
      default:
        return NextResponse.json(
          { error: `未知 action: ${String(body.action)}` },
          { status: 400 }
        )
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
