// 主题菜单统一使用这三种偏好；system 会随操作系统实时变化。
export const THEME_OPTIONS = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
] as const
