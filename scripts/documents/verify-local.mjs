import { config } from 'dotenv'
import { spawnSync } from 'node:child_process'

config({ path: '.env.local', quiet: true })
const url = new URL(process.env.DATABASE_URL || 'postgres://invalid/invalid')
const database = decodeURIComponent(url.pathname.slice(1))
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !(database.startsWith('wt_') || database === 'thread-chat-documents-test')) {
  throw new Error('请使用本机独立 wt_* 或 thread-chat-documents-test 数据库；此验收入口不连接远端或日常数据库。')
}
if (process.env.THREADCHAT_TEST_DB_MODULE || process.env.THREADCHAT_TEST_DB_SETUP)
  throw new Error('原生数据库验收不得配置内存数据库适配器。')
const env = { ...process.env, DB_POOL_MAX: '10', THREAD_CHAT_DOCUMENT_WRITES: 'true' }
const result = spawnSync(process.execPath, ['--import', 'tsx', 'e2e/thread-chat/shared-project-documents-db.test.mjs'], {
  env, stdio: 'inherit', timeout: 180000,
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
