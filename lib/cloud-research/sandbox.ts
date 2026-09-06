import { e2b } from "@computesdk/e2b"
import { CLOUD_RESEARCH } from "@/constants/cloud-research"

/** 固定只读程序；模型只传 JSON 参数，不能拼接 shell 或执行仓库脚本。 */
export const REPOSITORY_READER = String.raw`
import base64, json, pathlib, sys, zipfile, io, stat
root = pathlib.Path(${JSON.stringify(CLOUD_RESEARCH.root)})
args = json.loads(base64.b64decode(sys.argv[1]))
def allowed(path):
    return not any(p in ('.git', 'node_modules', '.next', '.ssh') or p.startswith('.env') or p.endswith(('.pem', '.key')) for p in path.parts)
if args['mode'] == 'extract':
    archive = pathlib.Path(${JSON.stringify(CLOUD_RESEARCH.archive)})
    raw = base64.b64decode(archive.read_bytes())
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        entries = z.infolist()
        if len(entries) > 10000 or sum(e.file_size for e in entries) > 100 * 1024 * 1024:
            raise ValueError('repository exceeds demo extraction limit')
        root.mkdir(parents=True, exist_ok=True)
        for entry in entries:
            path = pathlib.PurePosixPath(entry.filename)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('invalid archive path')
            relative = pathlib.Path(*path.parts[1:])
            if not relative.parts or entry.is_dir() or not allowed(relative):
                continue
            if stat.S_ISLNK(entry.external_attr >> 16):
                continue
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(entry))
    archive.unlink()
    args = {'mode': 'list', 'path': '', 'start': 1}
mode = args['mode']
relative = pathlib.Path(args.get('path', ''))
target = (root / relative).resolve()
if not target.is_relative_to(root) or not allowed(relative):
    raise ValueError('path outside permitted repository')
start = args.get('start', 1)
lines = []
if mode == 'list':
    lines = [str(p.relative_to(root)) for p in sorted(target.rglob('*')) if p.is_file() and allowed(p.relative_to(root))]
elif mode == 'read':
    if not target.is_file() or target.stat().st_size > 512 * 1024:
        raise ValueError('file missing or exceeds 512 KB')
    text = target.read_text(encoding='utf-8')
    lines = [f'{i+1}: {line[:1000]}' for i, line in enumerate(text.splitlines())]
elif mode == 'search':
    query = args.get('query', '').lower()
    if not query: raise ValueError('query required')
    for p in sorted(target.rglob('*')):
        if not p.is_file() or not allowed(p.relative_to(root)) or p.stat().st_size > 512 * 1024: continue
        try: text = p.read_text(encoding='utf-8')
        except (UnicodeError, OSError): continue
        for i, line in enumerate(text.splitlines()):
            if query in line.lower(): lines.append(f'{p.relative_to(root)}:{i+1}: {line[:500]}')
        if len(lines) >= start + 200: break
else:
    raise ValueError('unknown operation')
page = '\n'.join(lines[start-1:start+199])
print(json.dumps({'text': page[:24000], 'truncated': len(lines) > start+199 or len(page) > 24000}, ensure_ascii=False))
`

export async function createResearchSandbox(apiKey: string) {
  // ComputeSDK Direct Provider Mode；不维护自有厂商适配层。
  return e2b({ apiKey }).sandbox.create({ timeout: CLOUD_RESEARCH.timeoutMs })
}

export type ResearchSandbox = Awaited<ReturnType<typeof createResearchSandbox>>

export async function inspectSandbox(
  sandbox: ResearchSandbox,
  input: { mode: "extract" | "list" | "read" | "search"; path?: string; query?: string; start?: number },
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const encoded = Buffer.from(JSON.stringify(input)).toString("base64")
  const result = await sandbox.runCommand(`python3 ${CLOUD_RESEARCH.reader} '${encoded}'`, {
    timeout: CLOUD_RESEARCH.commandTimeoutMs,
  })
  signal.throwIfAborted()
  if (result.exitCode !== 0) throw new Error("沙箱读取失败：请检查路径、文件大小或尝试其他文件。")
  return JSON.parse(result.stdout) as { text: string; truncated: boolean }
}
