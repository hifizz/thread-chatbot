/** 后台壳与接口共用路径；新增页面只需添加独立路由和导航项。 */
export const ADMIN_ROUTES = { root: "/admin", models: "/admin/models", modelsApi: "/api/admin/models" } as const
export const ADMIN_NAVIGATION = [
  { title: "模型管理", href: ADMIN_ROUTES.models, icon: "models" },
] as const
