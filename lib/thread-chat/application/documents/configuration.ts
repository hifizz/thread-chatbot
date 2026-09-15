/** 工具注册与事务提交都读取此开关；提交时再次检查，防止绕过入口。 */
export function documentWritesEnabled(): boolean {
  return process.env.THREAD_CHAT_DOCUMENT_WRITES !== "false"
}
