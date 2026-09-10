import { notFound, redirect } from "next/navigation"
import { requireAdmin } from "@/lib/admin/auth"
import { ModelCatalogError } from "@/lib/model-catalog/errors"
import { AdminShell } from "@/components/admin/admin-shell"
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try { await requireAdmin() } catch (error) {
    if (error instanceof ModelCatalogError && error.status === 401) redirect("/sign-in?redirect=/admin")
    if (error instanceof ModelCatalogError && error.status === 403) notFound()
    throw error
  }
  return <AdminShell>{children}</AdminShell>
}
