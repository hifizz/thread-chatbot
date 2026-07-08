// 代码工作台的领域类型。DemoArtifact 以 toolCallId 为主键，
// 流式期间内容会被反复 upsert，complete 后成为该轮生成的最终快照。

export type DemoFile = {
  path: string
  content: string
}

export type DemoArtifactStatus = "streaming" | "complete"

export type DemoArtifact = {
  /** assistant-ui 的 toolCallId，同一次工具调用共享一个 artifact */
  id: string
  title: string
  files: DemoFile[]
  /** 模型追加声明的 npm 依赖（已合并默认依赖、剔除保留项） */
  dependencies: Record<string, string>
  status: DemoArtifactStatus
}
