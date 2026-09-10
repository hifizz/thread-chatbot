import { requireAdminPage } from "@/lib/admin/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default async function AdminPage() {
  await requireAdminPage()
  return <>
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">后台样板页</h1>
      <p className="mt-2 text-sm text-muted-foreground">后台功能将在这里逐步接入。以下内容仅为布局示例。</p>
    </div>
    <div className="grid gap-4 md:grid-cols-3" aria-hidden="true">
      {[1, 2, 3].map((slot) => <div key={slot} className="aspect-video rounded-xl bg-muted/50" />)}
    </div>
    <Card className="min-h-64 flex-1">
      <CardHeader><CardTitle>内容区域</CardTitle><CardDescription>暂无管理功能</CardDescription></CardHeader>
      <CardContent className="text-sm text-muted-foreground">后续页面会沿用侧边栏、页头和账号菜单。</CardContent>
    </Card>
  </>
}
