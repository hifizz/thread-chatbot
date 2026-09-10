"use client"

import { useState } from "react"
import { EFFORT_LEVELS } from "@/constants/generation-settings"
import { MODEL_LOGOS, MODEL_PROFILE_LABELS, MODEL_REQUEST_PROFILES } from "@/constants/model-catalog"
import { modelCatalogWriteSchema, type ModelCatalogWrite } from "@/lib/model-catalog/schema"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{title}</Label>{children}</div>
}
export function ModelEditor({ initial, onClose, onSave }: { initial: ModelCatalogWrite; onClose: () => void; onSave: (value: ModelCatalogWrite) => Promise<void> }) {
  const [value, setValue] = useState(initial)
  const [outputOptions, setOutputOptions] = useState(initial.config.outputTokenOptions.join(", "))
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const config = value.config
  const patch = (change: Partial<typeof config>) => setValue((v) => ({ ...v, config: { ...v.config, ...change } }))
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError("")
    const parsed = modelCatalogWriteSchema.safeParse({ ...value, config: { ...config, outputTokenOptions: outputOptions.split(/[,，]/).map((n) => Number(n.trim())) } })
    if (!parsed.success) { setError(parsed.error.issues.map((i) => i.message).join("；")); return }
    setBusy(true)
    try { await onSave(parsed.data); onClose() } catch (e) { setError(e instanceof Error ? e.message : "保存失败") }
    finally { setBusy(false) }
  }
  return <Sheet open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-2xl" showCloseButton={!busy}>
      <SheetHeader><SheetTitle>{initial.version ? "编辑模型" : "新增模型"}</SheetTitle><SheetDescription>保存后用于新的聊天请求。能力声明应与中转服务实际支持一致。</SheetDescription></SheetHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <fieldset disabled={busy} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field title="展示名称"><Input aria-label="展示名称" value={config.name} onChange={(e) => patch({ name: e.target.value })} required /></Field>
            <Field title="内部 ID（创建后固定）"><Input aria-label="内部 ID" value={value.id} disabled={initial.version > 0} onChange={(e) => setValue({ ...value, id: e.target.value })} required /></Field>
            <Field title="中转服务模型 ID"><Input aria-label="中转服务模型 ID" value={config.upstreamId} onChange={(e) => patch({ upstreamId: e.target.value })} required /></Field>
            <Field title="图标"><NativeSelect className="w-full" aria-label="图标" value={config.logo} onChange={(e) => patch({ logo: e.target.value as typeof config.logo })}>{MODEL_LOGOS.map((logo) => <NativeSelectOption key={logo} value={logo}>{logo === "auto" ? "自动识别" : logo === "generic" ? "通用模型" : logo}</NativeSelectOption>)}</NativeSelect></Field>
          </div>
          <Field title="简介"><Textarea aria-label="简介" value={config.description} onChange={(e) => patch({ description: e.target.value })} rows={2} /></Field>
          <Separator />
          <div className="space-y-3"><h3 className="font-medium">能力</h3><div className="flex flex-wrap gap-5">{([ ["imageInput", "图片输入"], ["toolCalling", "工具调用"], ["reasoning", "推理"] ] as const).map(([key, text]) => <Label key={key} className="flex items-center gap-2"><Checkbox checked={config[key]} onCheckedChange={(checked) => patch({ [key]: checked === true })} />{text}</Label>)}</div><p className="text-xs text-muted-foreground">文本、PDF 等文件由应用提取内容后传入；此处的图片输入指模型直接理解图片。</p></div>
          <Field title="请求兼容策略"><NativeSelect className="w-full" aria-label="请求兼容策略" value={config.profile} onChange={(e) => patch({ profile: e.target.value as typeof config.profile })}>{MODEL_REQUEST_PROFILES.map((p) => <NativeSelectOption key={p} value={p}>{MODEL_PROFILE_LABELS[p]}</NativeSelectOption>)}</NativeSelect></Field>
          <Field title="上下文窗口（token，未知可留空）"><Input aria-label="上下文窗口" type="number" min={1} value={config.contextWindow ?? ""} onChange={(e) => patch({ contextWindow: e.target.value ? Number(e.target.value) : null })} /></Field>
          <Separator />
          <div className="space-y-3"><h3 className="font-medium">思考强度</h3><div className="flex flex-wrap gap-4">{EFFORT_LEVELS.map((effort) => <Label key={effort} className="flex items-center gap-2"><Checkbox checked={config.effortLevels.includes(effort)} onCheckedChange={(checked) => patch({ effortLevels: checked ? [...config.effortLevels, effort] : config.effortLevels.filter((e) => e !== effort) })} />{effort}</Label>)}</div><p className="text-xs text-muted-foreground">不支持 effort 时，取消所有档位并将默认值设为“不发送”。</p></div>
          <Field title="默认 effort"><NativeSelect className="w-full" aria-label="默认 effort" value={config.defaultEffort ?? ""} onChange={(e) => patch({ defaultEffort: (e.target.value || null) as typeof config.defaultEffort })}><NativeSelectOption value="">不发送</NativeSelectOption>{config.effortLevels.map((e) => <NativeSelectOption key={e} value={e}>{e}</NativeSelectOption>)}</NativeSelect></Field>
          <Separator />
          <h3 className="font-medium">输出长度</h3>
          <div className="grid gap-4 sm:grid-cols-2"><Field title="模型输出上限"><Input aria-label="模型输出上限" type="number" min={1} required value={config.maxOutputTokens} onChange={(e) => patch({ maxOutputTokens: Number(e.target.value) })} /></Field><Field title="默认输出长度"><Input aria-label="默认输出长度" type="number" min={1} required value={config.defaultMaxOutputTokens} onChange={(e) => patch({ defaultMaxOutputTokens: Number(e.target.value) })} /></Field></div>
          <Field title="用户可选输出档位（逗号分隔）"><Input aria-label="用户可选输出档位" value={outputOptions} onChange={(e) => setOutputOptions(e.target.value)} required /></Field>
          <Separator />
          <div className="grid gap-4 sm:grid-cols-2"><Field title="排序（数字越小越靠前）"><Input aria-label="排序" type="number" min={0} value={value.sortOrder} onChange={(e) => setValue({ ...value, sortOrder: Number(e.target.value) })} /></Field><Label className="flex items-center gap-2"><Checkbox checked={value.enabled} onCheckedChange={(checked) => setValue({ ...value, enabled: checked === true })} />启用此模型</Label></div>
        </fieldset>
        <div className="space-y-3 border-t p-6">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>取消</Button><Button type="submit" disabled={busy}>{busy ? "正在保存…" : "保存模型"}</Button></div></div>
      </form>
    </SheetContent>
  </Sheet>
}
