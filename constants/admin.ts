/** 后台导航；添加功能时增加独立页面与对应导航项。 */
export const ADMIN_ROUTES = { root: "/admin" } as const
export const ADMIN_NAVIGATION = [
  { title: "ui.adminOverview", href: ADMIN_ROUTES.root },
] as const
