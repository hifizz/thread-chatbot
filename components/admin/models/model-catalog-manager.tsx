"use client"

import { useState } from "react"
import { Copy, MoreHorizontal, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { ADMIN_ROUTES } from "@/constants/admin"
import { MODEL_PROFILE_LABELS } from "@/constants/model-catalog"
import type { CatalogModel, ModelCatalogWrite } from "@/lib/model-catalog/schema"
import { ModelLogo } from "@/components/assistant-ui/model-logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ModelEditor } from "./model-editor"

type Catalog = { models: CatalogModel[]; defaultModelId: string; version: number }
async function requestCatalog(path: string, value?: unknown) {
  const response = await fetch(path, { cache: "no-store", ...(value !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) } : {}) })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "请求失败")
  return body
}
function newModel(sortOrder: number): ModelCatalogWrite {
  return { id: "", enabled: false, sortOrder, version: 0, config: {
    name: "", description: "", upstreamId: "", logo: "auto", profile: "openai-chat", contextWindow: null,
    imageInput: false, toolCalling: false, reasoning: false, effortLevels: [], defaultEffort: null,
    maxOutputTokens: 16_000, outputTokenOptions: [16_000], defaultMaxOutputTokens: 16_000,
  } }
}
function writeValue(model: CatalogModel): ModelCatalogWrite {
  return { id: model.id, enabled: model.enabled, sortOrder: model.sortOrder, version: model.version, config: model.config }
}
export function ModelCatalogManager({ initial }: { initial: Catalog }) {
  const [catalog, setCatalog] = useState(initial)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [editor, setEditor] = useState<ModelCatalogWrite | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function refresh() { setCatalog(await requestCatalog(ADMIN_ROUTES.modelsApi)) }
  async function save(value: ModelCatalogWrite) {
    await requestCatalog(ADMIN_ROUTES.modelsApi, value)
    await refresh()
    toast.success("模型配置已保存")
  }
  async function action(run: () => Promise<unknown>) {
    setBusy(true); setError("")
    try { await run(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : "操作失败") }
    finally { setBusy(false) }
  }
  const filtered = catalog.models.filter((m) => (status === "all" || m.enabled === (status === "enabled")) && `${m.config.name} ${m.id} ${m.config.upstreamId}`.toLowerCase().includes(query.toLowerCase()))
  return <>
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">模型管理</h1><p className="text-sm text-muted-foreground">管理可用模型、能力与生成默认值。保存后逐步生效，已打开的聊天页面保留原配置。</p></div><Button onClick={() => setEditor(newModel(catalog.models.length))} disabled={busy}><Plus />新增模型</Button></div>
    <div className="flex flex-wrap items-center gap-3"><div className="relative min-w-48 flex-1 sm:max-w-sm"><Search className="absolute left-3 top-2 size-4 text-muted-foreground" /><Input className="pl-9" aria-label="搜索模型" placeholder="搜索名称或模型 ID…" value={query} onChange={(e) => setQuery(e.target.value)} /></div><NativeSelect aria-label="筛选状态" value={status} onChange={(e) => setStatus(e.target.value)}><NativeSelectOption value="all">全部状态</NativeSelectOption><NativeSelectOption value="enabled">已启用</NativeSelectOption><NativeSelectOption value="disabled">已停用</NativeSelectOption></NativeSelect><span className="text-sm text-muted-foreground">{catalog.models.filter((m) => m.enabled).length} 个启用 · {catalog.models.length} 个模型</span><Button variant="ghost" disabled={busy} onClick={() => action(refresh)}>刷新</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="min-w-0 rounded-xl border">
      <Table><TableHeader><TableRow><TableHead className="pl-4">模型</TableHead><TableHead>状态</TableHead><TableHead>能力</TableHead><TableHead>默认参数</TableHead><TableHead>兼容策略</TableHead><TableHead className="w-12"><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>
        {filtered.map((model) => <TableRow key={model.id}>
          <TableCell className="py-4 pl-4"><div className="flex items-center gap-3"><ModelLogo modelId={model.config.logo === "auto" ? model.id : model.config.logo} size={20} /><div className="min-w-0"><Button variant="link" className="h-auto p-0 font-medium" onClick={() => setEditor(writeValue(model))}>{model.config.name}</Button><div className="max-w-64 truncate text-xs text-muted-foreground" title={model.id}>{model.id}</div></div></div></TableCell>
          <TableCell><div className="flex gap-2"><Badge variant={model.enabled ? "secondary" : "outline"}>{model.enabled ? "启用" : "停用"}</Badge>{catalog.defaultModelId === model.id && <Badge>默认</Badge>}</div></TableCell>
          <TableCell><div className="flex gap-1">{model.config.imageInput && <Badge variant="outline">视觉</Badge>}{model.config.toolCalling && <Badge variant="outline">工具</Badge>}{model.config.reasoning && <Badge variant="outline">推理</Badge>}{!model.config.imageInput && !model.config.toolCalling && !model.config.reasoning && <span className="text-muted-foreground">文本</span>}</div></TableCell>
          <TableCell><div className="text-sm">{model.config.defaultEffort ?? "不发送 effort"}</div><div className="text-xs text-muted-foreground">{model.config.defaultMaxOutputTokens.toLocaleString()} token</div></TableCell>
          <TableCell className="text-xs text-muted-foreground">{MODEL_PROFILE_LABELS[model.config.profile]}</TableCell>
          <TableCell><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`${model.config.name} 操作`} disabled={busy} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-40"><DropdownMenuItem onClick={() => setEditor(writeValue(model))}>编辑模型</DropdownMenuItem><DropdownMenuItem onClick={() => setEditor({ ...writeValue(model), id: "", version: 0, enabled: false, config: { ...model.config, name: `${model.config.name} 副本` } })}><Copy />复制配置</DropdownMenuItem><DropdownMenuItem disabled={!model.enabled || catalog.defaultModelId === model.id} onClick={() => action(() => requestCatalog(`${ADMIN_ROUTES.modelsApi}/default`, { id: model.id, version: catalog.version }))}>设为默认模型</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem disabled={catalog.defaultModelId === model.id} onClick={() => action(() => requestCatalog(ADMIN_ROUTES.modelsApi, { ...writeValue(model), enabled: !model.enabled }))}>{model.enabled ? "停用模型" : "启用模型"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
        </TableRow>)}
        {!filtered.length && <TableRow><TableCell colSpan={6} className="h-36 text-center text-muted-foreground">没有符合条件的模型</TableCell></TableRow>}
      </TableBody></Table>
    </div>
    <p className="text-xs text-muted-foreground">停用不会删除历史对话。默认模型需要先更换才能停用。</p>
    {editor && <ModelEditor key={`${editor.id}:${editor.version}`} initial={editor} onClose={() => setEditor(null)} onSave={save} />}
  </>
}
