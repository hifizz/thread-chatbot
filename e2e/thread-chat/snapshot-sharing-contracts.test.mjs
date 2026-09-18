import assert from "node:assert/strict"
import {
  createShareCommandSchema,
  shareLayoutSchema,
  listSharesQuerySchema,
} from "../../lib/thread-chat/sharing/contracts.ts"
import {
  SHARE_EXPIRY_OPTIONS,
  SHARE_EXPIRY_VALUES,
  shareExpiryDays,
} from "../../constants/sharing.ts"

const uid = () => crypto.randomUUID()

const validLayout = {
  view: "columns",
  columnSlots: [{ threadId: uid(), folded: false }],
  columnWidths: { [uid()]: 420 },
  forceColumns: null,
  placementMode: "replace",
  selectedThreadId: null,
  canvas: { pins: {}, viewport: { x: 0, y: 0, zoom: 1 } },
  panelSizes: {},
  expandedNodes: [],
  activeArtifactId: null,
  drawerOpen: false,
}

// 期限枚举：恰好四个选项、默认无限、d→天数映射
assert.deepEqual(SHARE_EXPIRY_VALUES, ["d3", "d7", "d30", "never"])
assert.equal(SHARE_EXPIRY_OPTIONS.length, 4)
assert.equal(shareExpiryDays("d3"), 3)
assert.equal(shareExpiryDays("d7"), 7)
assert.equal(shareExpiryDays("d30"), 30)
assert.equal(shareExpiryDays("never"), null)
console.log("期限枚举与映射：5 项通过")

// 合法创建命令
const projectCmd = {
  commandId: uid(),
  resourceType: "project",
  projectId: uid(),
  expiresIn: "d7",
  layout: validLayout,
}
assert.equal(createShareCommandSchema.parse(projectCmd).resourceType, "project")
const docCmd = {
  commandId: uid(),
  resourceType: "document",
  documentId: uid(),
}
assert.equal(createShareCommandSchema.parse(docCmd).resourceType, "document")
console.log("判别联合合法输入：2 项通过")

// 严格拒绝：正文/owner/token/自定义期限/未知类型/多余字段
for (const bad of [
  { ...projectCmd, ownerId: uid() },
  { ...projectCmd, token: "x".repeat(32) },
  { ...projectCmd, content: "私货正文" },
  { ...projectCmd, expiresAt: new Date().toISOString() },
  { ...projectCmd, expiresIn: "d90" },
  { ...projectCmd, expiresIn: 999 },
  { ...projectCmd, resourceType: "thread" },
  { ...docCmd, layout: validLayout }, // document 不接受布局
  { ...projectCmd, extra: true },
])
  assert.equal(createShareCommandSchema.safeParse(bad).success, false, JSON.stringify(bad))
console.log("严格拒绝私有/越界字段：9 项通过")

// 布局边界：非法 ID、越界数值、超量结构
for (const bad of [
  { ...validLayout, columnSlots: [{ threadId: "not-uuid", folded: false }] },
  { ...validLayout, columnWidths: { [uid()]: Number.POSITIVE_INFINITY } },
  { ...validLayout, columnWidths: { [uid()]: -5 } },
  { ...validLayout, forceColumns: 0 },
  { ...validLayout, forceColumns: 99 },
  { ...validLayout, view: "grid" },
  { ...validLayout, placementMode: "stack" },
  {
    ...validLayout,
    canvas: { pins: {}, viewport: { x: 0, y: 0, zoom: 100 } },
  },
  {
    ...validLayout,
    columnSlots: Array.from({ length: 65 }, () => ({
      threadId: uid(),
      folded: false,
    })),
  },
  { ...validLayout, selectedThreadId: "abc" },
])
  assert.equal(shareLayoutSchema.safeParse(bad).success, false, JSON.stringify(bad))
console.log("布局边界拒绝：10 项通过")

// 列表查询契约
assert.equal(
  listSharesQuerySchema.safeParse({ resourceType: "project", resourceId: uid() })
    .success,
  true
)
assert.equal(
  listSharesQuerySchema.safeParse({ resourceType: "x", resourceId: uid() }).success,
  false
)
assert.equal(
  listSharesQuerySchema.safeParse({ resourceType: "project" }).success,
  false
)
console.log("列表查询契约：3 项通过")
