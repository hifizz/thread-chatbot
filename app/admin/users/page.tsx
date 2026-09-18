import Link from "next/link"
import { requireAdminPage } from "@/lib/admin/auth"
import { listAdminUsers } from "@/lib/admin/metrics"
import { getTranslator } from "@/lib/i18n/server"
import { ADMIN_USER_SEARCH_MAX_LIMIT } from "@/constants/analytics"
import { ADMIN_ROUTES } from "@/constants/admin"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const PAGE_SIZE = 20

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>
}) {
  const t = await getTranslator()
  await requireAdminPage()

  const params = await searchParams
  const parsed = Number(params.offset ?? "0")
  const offset = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  const { users, total } = await listAdminUsers({
    limit: Math.min(PAGE_SIZE, ADMIN_USER_SEARCH_MAX_LIMIT),
    offset,
  })
  const nextOffset = offset + users.length
  const prevOffset = Math.max(0, offset - PAGE_SIZE)

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("admin.users")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("admin.userList.note")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {total} {t("admin.userList.total")}
          </CardTitle>
          <CardDescription>{t("admin.userList.order")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.userList.name")}</TableHead>
                <TableHead>{t("admin.userList.email")}</TableHead>
                <TableHead>{t("admin.userList.registered")}</TableHead>
                <TableHead>{t("admin.userList.lastActive")}</TableHead>
                <TableHead className="text-end">
                  {t("admin.userList.completed")}
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.userId}>
                  <TableCell>
                    {user.name}
                    {user.internalTestUser && (
                      <Badge variant="secondary" className="ms-2">
                        {t("admin.userList.internal")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {user.email}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {user.registeredAt.slice(0, 10)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {user.lastServiceActionAt?.slice(0, 10) ?? "—"}
                  </TableCell>
                  <TableCell className="text-end">
                    {user.completedGenerations}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      render={
                        <Link
                          href={`${ADMIN_ROUTES.users}/${user.userId}`}
                          prefetch={false}
                        />
                      }
                    >
                      {t("admin.userList.view")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              render={
                <Link
                  href={`${ADMIN_ROUTES.users}?offset=${prevOffset}`}
                  prefetch={false}
                />
              }
            >
              {t("ui.previous")}
            </Button>
            <span className="text-sm text-muted-foreground">
              {offset + 1}–{nextOffset} / {total}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={nextOffset >= total}
              render={
                <Link
                  href={`${ADMIN_ROUTES.users}?offset=${nextOffset}`}
                  prefetch={false}
                />
              }
            >
              {t("ui.next")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
