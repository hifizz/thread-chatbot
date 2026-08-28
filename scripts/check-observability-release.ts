import { config } from "dotenv"
import { evaluateObservabilityReleaseReadiness } from "@/lib/observability/release-readiness"

config({ path: ".env.local" })

const report = evaluateObservabilityReleaseReadiness()
console.log(JSON.stringify(report, null, 2))
if (!report.ready) process.exitCode = 1
