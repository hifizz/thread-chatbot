"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowLeft, LayoutDashboard, Command } from "lucide-react"
import { ADMIN_NAVIGATION, ADMIN_ROUTES } from "@/constants/admin"
import { UserMenu } from "@/components/auth/user-menu"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"

/** 来源：shadcn-ui/ui apps/v4/registry/bases/base/blocks/sidebar-08（MIT）。 */
function AdminSidebar() {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  return <Sidebar variant="inset">
    <SidebarHeader>
      <SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" render={<Link href={ADMIN_ROUTES.root} />}>
        <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><Command className="size-4" /></div>
        <div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-medium">ThreadChat</span><span className="truncate text-xs text-muted-foreground">管理后台</span></div>
      </SidebarMenuButton></SidebarMenuItem></SidebarMenu>
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup><SidebarGroupLabel>管理</SidebarGroupLabel><SidebarMenu>
        {ADMIN_NAVIGATION.map((item) => <SidebarMenuItem key={item.href}><SidebarMenuButton isActive={(pathname === item.href || (item.href !== ADMIN_ROUTES.root && pathname.startsWith(`${item.href}/`)))} render={<Link href={item.href} />} onClick={() => { if (isMobile) setOpenMobile(false) }}><LayoutDashboard /><span>{item.title}</span></SidebarMenuButton></SidebarMenuItem>)}
      </SidebarMenu></SidebarGroup>
      <SidebarGroup className="mt-auto"><SidebarMenu><SidebarMenuItem><SidebarMenuButton render={<Link href="/thread-chat" prefetch={false} />}><ArrowLeft /><span>返回对话</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroup>
    </SidebarContent>
    <SidebarFooter><UserMenu /></SidebarFooter>
  </Sidebar>
}
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const active = ADMIN_NAVIGATION.find((item) => (pathname === item.href || (item.href !== ADMIN_ROUTES.root && pathname.startsWith(`${item.href}/`))))
  return <SidebarProvider>
    <AdminSidebar />
    <SidebarInset className="min-w-0">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger aria-label="切换侧边栏" className="-ml-1" /><Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
        <Breadcrumb><BreadcrumbList><BreadcrumbItem className="hidden md:block"><BreadcrumbLink render={<Link href={ADMIN_ROUTES.root} />}>管理后台</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator className="hidden md:block" /><BreadcrumbItem><BreadcrumbPage>{active?.title ?? "管理后台"}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
      </header>
      <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-8">{children}</div>
    </SidebarInset>
  </SidebarProvider>
}
