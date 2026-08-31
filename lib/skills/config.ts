type EnvironmentSource = Record<string, string | undefined>

export interface RuntimeSkillFeatureConfig {
  /** 是否向客户端/API 暴露可选择的当前 Skill Catalog。 */
  catalogDiscoveryEnabled: boolean
  /** 是否在 Composer 展示 Slash Skill 选择 UI。 */
  composerUiEnabled: boolean
}

function isEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue
  return !["0", "false", "off", "no"].includes(value.toLowerCase())
}

/**
 * 这里只控制 Skill 的发现与选择入口。
 *
 * 已固定到 assistant Message 的 SkillVersion 执行不受这些开关影响；否则一次
 * 已接受的后台 Generation 会因部署配置变化而失去可复现性。运行时执行路径不得
 * 使用本配置作为授权或回滚条件。
 */
export function resolveRuntimeSkillFeatureConfig(
  source: EnvironmentSource = process.env
): RuntimeSkillFeatureConfig {
  const catalogDiscoveryEnabled = isEnabled(
    source.THREAD_CHAT_SKILLS_CATALOG_ENABLED,
    true
  )

  return {
    catalogDiscoveryEnabled,
    composerUiEnabled:
      catalogDiscoveryEnabled &&
      isEnabled(source.THREAD_CHAT_SKILLS_UI_ENABLED, true),
  }
}
