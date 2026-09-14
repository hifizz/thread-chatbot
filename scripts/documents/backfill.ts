import "dotenv/config"
import { registerExistingDocuments } from "@/lib/thread-chat/application/documents/register-existing"

let registered = 0
try {
  await registerExistingDocuments((count) => { registered = count })
  console.log(`文档登记完成：新增 ${registered} 项，已登记和不符合条件的产物跳过。`)
  process.exit(0)
} catch (error) {
  console.error(`文档登记中断，已新增 ${registered} 项，可重新运行。`, error)
  process.exit(1)
}
