import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REPOSITORY_READER } from "../../lib/cloud-research/sandbox.ts"
import { CLOUD_RESEARCH } from "../../constants/cloud-research.ts"

const temp = mkdtempSync(join(tmpdir(), "cloud-research-test-"))
const root = join(temp, "repository")
const archive = join(temp, "archive.b64")
const script = join(temp, "read.py")
writeFileSync(script, REPOSITORY_READER.replaceAll(CLOUD_RESEARCH.archive, archive).replaceAll(CLOUD_RESEARCH.root, root))
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64")
const read = (value) => JSON.parse(execFileSync("python3", [script, encode(value)], { encoding: "utf8" }))
try {
  execFileSync("python3", ["-c", `
import base64, io, zipfile, sys
b = io.BytesIO()
with zipfile.ZipFile(b, 'w') as z:
    z.writestr('repo/README.md', '\\n'.join('line '+str(i) for i in range(1,206)))
    z.writestr('repo/.env.local', 'hidden-token')
    z.writestr('repo/src/index.ts', 'export const agent = true')
    symlink = zipfile.ZipInfo('repo/link')
    symlink.create_system = 3
    symlink.external_attr = 0o120777 << 16
    z.writestr(symlink, '/etc/passwd')
open(sys.argv[1], 'w').write(base64.b64encode(b.getvalue()).decode())
`, archive])
  const listing = read({ mode: "extract" })
  assert(listing.text.includes("src/index.ts"))
  assert.equal(listing.text.includes(".env.local"), false)
  assert.equal(existsSync(join(root, "link")), false)
  const first = read({ mode: "read", path: "README.md" })
  assert.equal(first.truncated, true)
  assert.equal(first.text.split("\n").length, 200)
  assert.equal(read({ mode: "read", path: "README.md", start: 201 }).text.split("\n").length, 5)
  assert(read({ mode: "search", path: "src", query: "agent" }).text.includes("src/index.ts:1"))
  assert.equal(read({ mode: "search", query: "$(touch hacked)" }).text, "")
  for (const path of ["../../etc/passwd", "/etc/passwd", ".env.local"]) {
    assert.notEqual(spawnSync("python3", [script, encode({ mode: "read", path })]).status, 0)
  }
  assert.equal(readFileSync(join(root, "src/index.ts"), "utf8"), "export const agent = true")
  execFileSync("python3", ["-c", `
import base64, io, zipfile, sys
b = io.BytesIO()
with zipfile.ZipFile(b, 'w') as z: z.writestr('repo/../../escape', 'bad')
open(sys.argv[1], 'w').write(base64.b64encode(b.getvalue()).decode())
`, archive])
  assert.notEqual(spawnSync("python3", [script, encode({ mode: "extract" })]).status, 0)
  console.log("PASS 同一份 Python 读取器：解压、分页、检索、路径限制、跳过密钥/符号链接与 archive 越界拒绝")
} finally {
  rmSync(temp, { recursive: true, force: true })
}
