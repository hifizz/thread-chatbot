import { fakeClaudeCacheProbe } from "@/lib/ai/prompt-cache-probe"

function main() {
  const live = process.argv.includes("--live")
  if (live) {
    throw new Error(
      "LIVE_PROMPT_CACHE_PROBE_REQUIRES_APPROVED_PROVIDER_ADAPTER_AND_CREDENTIALS"
    )
  }
  const result = fakeClaudeCacheProbe()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.decision.enable) process.exitCode = 1
}

main()
