/** 模型入口文案；分支与生成中的限制沿用现有会话规则。 */
export const COMPOSER_MODEL_COPY = {
  choose: "选择对话模型",
  failed: "模型切换失败，请重试",
  current: "当前模型",
  branchLocked: "非主线分支暂不支持修改模型和生成参数，请在主线中调整",
  busy: "回复生成中，暂不可切换模型",
  unavailable: "当前会话暂不可切换模型",
} as const
