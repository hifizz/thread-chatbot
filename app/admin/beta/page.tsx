import { asc, inArray } from "drizzle-orm"
import { BetaWaitlistActions } from "@/components/admin/beta-waitlist-actions"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { db } from "@/lib/db"
import { betaWaitlistEntries } from "@/lib/db/schema"

export const dynamic = "force-dynamic"

export default async function AdminBetaPage() {
  const entries = await db
    .select()
    .from(betaWaitlistEntries)
    .where(inArray(betaWaitlistEntries.status, ["pending", "approved"]))
    .orderBy(asc(betaWaitlistEntries.createdAt))
    .limit(200)

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Private Beta 审核</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          批准会签发新 token、加密写入邮件 outbox，并在事务提交后发送。重发会先撤销旧邀请。
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>待处理与已批准申请</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>邮箱</TableHead>
                <TableHead>语言</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>申请时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.emailNormalized}</TableCell>
                  <TableCell>{entry.locale}</TableCell>
                  <TableCell><Badge variant="secondary">{entry.status}</Badge></TableCell>
                  <TableCell>{entry.createdAt.toISOString()}</TableCell>
                  <TableCell>
                    <BetaWaitlistActions entryId={entry.id} approved={entry.status === "approved"} />
                  </TableCell>
                </TableRow>
              ))}
              {entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    暂无待处理申请
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
