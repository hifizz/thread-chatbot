import { requireAdminPage } from "@/lib/admin/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getTranslator } from "@/lib/i18n/server"


export default async function AdminPage() {
  const t = await getTranslator()

  await requireAdminPage()
  return <>
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("ui.adminOverview")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("ui.managementFeaturesWillAppearHereThe")}</p>
    </div>
    <div className="grid gap-4 md:grid-cols-3" aria-hidden="true">
      {[1, 2, 3].map((slot) => <div key={slot} className="aspect-video rounded-xl bg-muted/50" />)}
    </div>
    <Card className="min-h-64 flex-1">
      <CardHeader><CardTitle>{t("ui.contentArea")}</CardTitle><CardDescription>{t("ui.noManagementFeaturesYet")}</CardDescription></CardHeader>
      <CardContent className="text-sm text-muted-foreground">{t("ui.futurePagesWillReuseThisSidebar")}</CardContent>
    </Card>
  </>
}
