/**
 * lib/chat/tree-id —— 分支树 treeId 的形状校验（UUID）。
 *
 * treeId 由客户端 crypto.randomUUID() 生成、URL 路径段承载（/thread-chat/{treeId}）。
 * 路由（[treeId]/page.tsx）与 API（/api/branch-trees/[treeId]）共用同一校验作为安全阀，
 * 避免任意字符串打到 DB 主键——放 lib/ 供服务端与客户端两侧复用。
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** treeId 是否为 UUID 形状（大小写不敏感） */
export function isValidTreeId(id: string): boolean {
  return UUID_RE.test(id)
}
