// Apple container（github.com/apple/container）沙箱管理器：封装 container CLI，
// 每个 Demo artifact 一个轻量 VM（真 next dev），仅在服务端（route handler）使用。
//
// 设计要点：
// - 文件用 `container cp` 写进 VM 内部文件系统（不做宿主 bind mount）：
//   VM 内原生 inotify 让 next dev 的 HMR 正常工作，也避免 virtiofs 的 watch 问题。
// - CLI 的 JSON 输出结构未形成稳定契约（1.0），解析走"宽容提取"：按名字匹配条目，
//   用正则从条目 JSON 里捞 IPv4，避免耦合具体字段层级。
// - 镜像构建耗时（分钟级），异步启动并把状态挂在 globalThis 上（dev HMR 不丢）。

import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  SANDBOX_CPUS,
  SANDBOX_DEMO_DIR,
  SANDBOX_IMAGE,
  SANDBOX_MEMORY,
  SANDBOX_NAME_PREFIX,
  SANDBOX_NPM_REGISTRY,
  SANDBOX_PORT,
} from "@/constants/sandbox"

const execFileAsync = promisify(execFile)

const CONTAINER_BIN = process.env.CONTAINER_BIN ?? "container"

type BuildState = {
  building: boolean
  log: string
  error: string | null
}

// dev 模式下模块会被 HMR 重建，构建状态挂到 globalThis 上保活（与 lib/db 单例同一手法）
const globalStash = globalThis as unknown as {
  __sandboxBuildState?: BuildState
}
function buildState(): BuildState {
  globalStash.__sandboxBuildState ??= { building: false, log: "", error: null }
  return globalStash.__sandboxBuildState
}

async function containerCmd(args: string[], timeout = 60_000) {
  return execFileAsync(CONTAINER_BIN, args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  })
}

/** container CLI 是否可用且 apiserver 在运行 */
export async function isAvailable(): Promise<boolean> {
  try {
    const { stdout } = await containerCmd(["system", "status"], 10_000)
    return /running/i.test(stdout)
  } catch {
    return false
  }
}

export async function imageReady(): Promise<boolean> {
  try {
    const { stdout } = await containerCmd(
      ["image", "list", "--format", "json"],
      20_000
    )
    return stdout.includes(SANDBOX_IMAGE.split(":")[0])
  } catch {
    return false
  }
}

/** 异步触发基础镜像构建（幂等：构建中重复调用直接返回） */
export function startImageBuild(): BuildState {
  const state = buildState()
  if (state.building) return state
  state.building = true
  state.error = null
  state.log = "开始构建镜像…\n"

  const child = spawn(
    CONTAINER_BIN,
    [
      "build",
      "-t",
      SANDBOX_IMAGE,
      "--build-arg",
      `NPM_REGISTRY=${SANDBOX_NPM_REGISTRY}`,
      "-f",
      "sandbox-template/Dockerfile",
      "sandbox-template/",
    ],
    { cwd: process.cwd() }
  )
  const append = (chunk: Buffer) => {
    state.log = (state.log + chunk.toString()).slice(-8000)
  }
  child.stdout.on("data", append)
  child.stderr.on("data", append)
  child.on("close", (code) => {
    state.building = false
    if (code !== 0) state.error = `构建失败（exit ${code}），详见日志`
  })
  child.on("error", (err) => {
    state.building = false
    state.error = String(err)
  })
  return state
}

export function getBuildState(): BuildState {
  return buildState()
}

export function sandboxName(artifactId: string): string {
  return (
    SANDBOX_NAME_PREFIX +
    createHash("sha1").update(artifactId).digest("hex").slice(0, 10)
  )
}

type SandboxInfo = {
  name: string
  running: boolean
  ip: string | null
  url: string | null
}

/**
 * 解析 `container ls --all --format json`（1.0 实测结构：
 * `.id`、`.status.state`、`.status.networks[0].ipv4Address = "a.b.c.d/24"`），
 * 字段缺失时用正则从条目 JSON 兜底提取 IPv4。
 */
export async function getSandbox(name: string): Promise<SandboxInfo | null> {
  const { stdout } = await containerCmd(
    ["ls", "--all", "--format", "json"],
    20_000
  )
  let items: unknown[]
  try {
    items = JSON.parse(stdout)
  } catch {
    return null
  }
  type LsItem = {
    id?: string
    configuration?: { id?: string }
    status?: { state?: string; networks?: { ipv4Address?: string }[] }
  }
  const item = (items as LsItem[]).find(
    (it) => it?.id === name || it?.configuration?.id === name
  )
  if (!item) return null
  const running = item.status?.state === "running"
  const cidr = item.status?.networks?.[0]?.ipv4Address
  const ip =
    (typeof cidr === "string" ? cidr.split("/")[0] : null) ??
    JSON.stringify(item).match(/(\d{1,3}(?:\.\d{1,3}){3})\/\d+/)?.[1] ??
    null
  return { name, running, ip, url: ip ? `http://${ip}:${SANDBOX_PORT}` : null }
}

/** 确保沙箱存在且在运行；必要时创建（VM 启动约几秒 + next dev 启动） */
export async function ensureSandbox(artifactId: string): Promise<SandboxInfo> {
  const name = sandboxName(artifactId)
  const existing = await getSandbox(name)
  if (existing?.running && existing.ip) return existing
  if (existing && !existing.running) {
    await containerCmd(["start", name], 120_000)
  } else if (!existing) {
    // 资源参数在部分版本可能不存在，失败时降级为默认配置重试
    const baseArgs = ["run", "-d", "--name", name]
    try {
      await containerCmd(
        [
          ...baseArgs,
          "--cpus",
          SANDBOX_CPUS,
          "--memory",
          SANDBOX_MEMORY,
          SANDBOX_IMAGE,
        ],
        180_000
      )
    } catch {
      await containerCmd([...baseArgs, SANDBOX_IMAGE], 180_000)
    }
  }
  const info = await getSandbox(name)
  if (!info?.ip) throw new Error(`沙箱 ${name} 已创建但未取得 IP`)
  return info
}

function assertSafeRelPath(path: string): string {
  const rel = path.replace(/^\/+/, "")
  if (
    !rel ||
    rel
      .split("/")
      .some((seg) => seg === ".." || seg === "" || seg.startsWith("."))
  ) {
    throw new Error(`非法文件路径: ${path}`)
  }
  return rel
}

/** demo 入口及组件在 Next 中处于客户端边界，缺少指令时自动补 "use client" */
function withUseClient(rel: string, content: string): string {
  if (!/\.(tsx|jsx)$/.test(rel)) return content
  const head = content.trimStart()
  if (head.startsWith('"use client"') || head.startsWith("'use client'"))
    return content
  return `"use client"\n\n${content}`
}

/** 把文件流从宿主管道送进容器内进程的 stdin（container exec -i） */
function execWithStdinFile(
  args: string[],
  stdinFile: string,
  timeout = 60_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(CONTAINER_BIN, args, {
      stdio: ["pipe", "ignore", "pipe"],
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`container ${args[0]} 超时`))
    }, timeout)
    let stderr = ""
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()))
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(stderr || `container ${args[0]} exit ${code}`))
    })
    child.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    createReadStream(stdinFile).pipe(child.stdin)
  })
}

/**
 * 把 Demo 文件写入沙箱的 /srv/app/demo：宿主暂存目录打 tar，
 * 经 `container exec -i <name> tar -x` 管道解包（Apple container 的 cp
 * 不支持 docker 的 `dir/.` 内容语义，tar 管道能原样保留目录树）。
 */
export async function applyFiles(
  artifactId: string,
  files: { path: string; content: string }[]
): Promise<{ name: string; count: number }> {
  const name = sandboxName(artifactId)
  const staging = await mkdtemp(join(tmpdir(), "tc-sbx-files-"))
  try {
    let count = 0
    for (const file of files) {
      const rel = assertSafeRelPath(file.path)
      const abs = join(staging, rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, withUseClient(rel, file.content), "utf8")
      count++
    }
    if (count === 0) return { name, count }
    const tarFile = join(staging, "..", `${name}-sync.tar`)
    await execFileAsync("tar", ["-cf", tarFile, "-C", staging, "."], {
      timeout: 20_000,
    })
    try {
      await execWithStdinFile(
        ["exec", "-i", name, "tar", "-xf", "-", "-C", SANDBOX_DEMO_DIR],
        tarFile
      )
    } finally {
      await rm(tarFile, { force: true })
    }
    return { name, count }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** 从宿主侧探测 next dev 是否就绪（任何 HTTP 响应都算 up，编译错误由 iframe 展示） */
export async function probeReady(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500), cache: "no-store" })
    return true
  } catch {
    return false
  }
}

export async function sandboxLogs(name: string, lines = 40): Promise<string> {
  try {
    const { stdout, stderr } = await containerCmd(["logs", name], 20_000)
    const text = [stdout, stderr].filter(Boolean).join("\n")
    return text.split("\n").slice(-lines).join("\n")
  } catch (err) {
    return `获取日志失败: ${String(err)}`
  }
}

export async function destroySandbox(artifactId: string): Promise<void> {
  const name = sandboxName(artifactId)
  try {
    await containerCmd(["stop", name], 60_000)
  } catch {
    // 已停止/不存在均忽略
  }
  try {
    await containerCmd(["delete", name], 60_000)
  } catch {
    // 不存在则忽略
  }
}
