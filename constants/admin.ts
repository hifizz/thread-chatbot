/** 后台导航；添加功能时增加独立页面与对应导航项。 */
export const ADMIN_ROUTES = { root: "/admin", beta: "/admin/beta" } as const
export const ADMIN_NAVIGATION = [
  { title: "后台样板页", href: ADMIN_ROUTES.root },
  { title: "Private Beta", href: ADMIN_ROUTES.beta },
] as const
