import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  FakePromptCacheProbeAdapter,
  runPromptCacheProbe,
} from "@/lib/thread-chat/prompt-cache/route-probe"

function argument(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

async function main() {
  const output = resolve(
    process.cwd(),
    argument("output") ?? "evals/agent/results/local/prompt-cache-probe.json"
  )
  const mode = argument("mode") ?? "fake"
  if (mode !== "fake") {
    throw new Error(
      "Live prompt-cache probes require an explicitly implemented and approved route adapter; UMAPIS remains probe-required."
    )
  }

  const result = await runPromptCacheProbe({
    adapter: new FakePromptCacheProbeAdapter({
      routeId: "fake:umapis-claude-contract",
    }),
    stablePrefix: [
      "agent-kernel-v1",
      "frozen-parent-history",
      "completed-branch-history",
    ].join("\n"),
    warmupTail: "warm-up",
    reuseTail: "sibling-branch",
  })
  const envelope = {
    schemaVersion: "prompt-cache-probe-v1",
    mode,
    generatedAt: new Date().toISOString(),
    evidence: "fake-verified",
    productionRouteEnabled: false,
    result,
  }
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(resolve(output, ".."), { recursive: true })
  )
  await writeFile(output, `${JSON.stringify(envelope, null, 2)}\n`, "utf8")
  console.log(JSON.stringify(envelope, null, 2))
  if (!result.enableRecommended) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
