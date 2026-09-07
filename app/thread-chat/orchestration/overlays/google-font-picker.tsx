"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { GOOGLE_FONT_TARGETS, type GoogleFontTarget } from "@/constants/google-fonts"
import { useGoogleFontSettings } from "@/hooks/use-google-font-settings"

export function GoogleFontPicker() {
  const [input, setInput] = useState("")
  const [target, setTarget] = useState<GoogleFontTarget>("english")
  const { preferences, statuses, apply, reset } = useGoogleFontSettings()
  const status = statuses[target]

  return (
    <details className="google-font-picker">
      <summary>添加 Google 字体</summary>
      <form onSubmit={(event) => { event.preventDefault(); void apply(input, target) }}>
        <label htmlFor="google-font-input">字体链接或名称</label>
        <Input
          id="google-font-input"
          placeholder="粘贴 Google Fonts 链接或名称"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          autoComplete="off"
          required
        />
        <label htmlFor="google-font-target">应用位置</label>
        <NativeSelect id="google-font-target" value={target} onChange={(event) => {
          const match = GOOGLE_FONT_TARGETS.find(({ id }) => id === event.target.value)
          if (match) setTarget(match.id)
        }}>
          {GOOGLE_FONT_TARGETS.map(({ id, label }) => <NativeSelectOption key={id} value={id}>{label}</NativeSelectOption>)}
        </NativeSelect>
        <small>当前：{preferences.active[target] ?? (target === "english" ? "Gelasio" : "预设字体")}</small>
        <div className="font-picker-actions">
          <Button type="submit" size="sm" disabled={status?.loading || !input.trim()}>加载并应用</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => reset(target)}>恢复预设</Button>
        </div>
        <small role="status" aria-live="polite">{status?.message ?? "首次加载需要连接 Google 字体服务"}</small>
      </form>
      {preferences.recent.length > 0 && (
        <div className="font-picker-recent" aria-label="最近使用的字体">
          <span>最近使用 · 点击应用到当前所选位置</span>
          <div className="font-picker-actions font-picker-history" tabIndex={0} role="region" aria-label="字体历史，可滚动查看">
            {preferences.recent.map((name) => (
              <Button key={name} type="button" size="sm" variant="outline" onClick={() => {
                setInput(name)
                void apply(name, target)
              }}>{name}</Button>
            ))}
          </div>
        </div>
      )}
    </details>
  )
}
