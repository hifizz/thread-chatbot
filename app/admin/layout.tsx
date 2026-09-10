import { requireAdminPage } from "@/lib/admin/auth"
import { AdminShell } from "@/components/admin/admin-shell"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage()
  return <AdminShell>{children}</AdminShell>
}
