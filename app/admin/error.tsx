"use client"
import { Button } from "@/components/ui/button"
export default function AdminError({ reset }: { reset: () => void }) {
  return <div className="space-y-4 p-8"><h2 className="text-lg font-medium">后台暂时无法加载</h2><p className="text-sm text-muted-foreground">请稍后重试。首次部署请检查模型目录是否已初始化。</p><Button onClick={reset}>重新加载</Button></div>
}
