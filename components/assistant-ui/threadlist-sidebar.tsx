import type * as React from "react";
import { MessagesSquare } from "lucide-react";
import { GitHubIcon } from "@/components/icons/github";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { PulseBeam } from "@/components/assistant-ui/pulse-beam";

export function ThreadListSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar {...props}>
      {/* 光晕贴着侧边栏面板内侧呼吸；floating 变体的内面板是 rounded-2xl（16px）。
          SidebarRail 靠绝对定位悬在面板边缘，放在光晕外以免被 overflow:hidden 裁掉。 */}
      <PulseBeam borderRadius={16} className="flex h-full min-h-0 w-full flex-col">
        <SidebarHeader className="aui-sidebar-header mb-2 border-b">
          <div className="aui-sidebar-header-content flex items-center justify-between">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" render={<a href="https://assistant-ui.com" target="_blank" rel="noopener noreferrer" />}><div className="aui-sidebar-header-icon-wrapper bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                                                <MessagesSquare className="aui-sidebar-header-icon size-4" />
                                              </div><div className="aui-sidebar-header-heading me-6 flex flex-col gap-0.5 leading-none">
                                                <span className="aui-sidebar-header-title font-semibold">
                                                  assistant-ui
                                                </span>
                                              </div></SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
        </SidebarHeader>
        <SidebarContent className="aui-sidebar-content px-2">
          <ThreadList />
        </SidebarContent>
        <SidebarFooter className="aui-sidebar-footer border-t">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" render={<a href="https://github.com/assistant-ui/assistant-ui" target="_blank" rel="noopener noreferrer" />}><div className="aui-sidebar-footer-icon-wrapper bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                                          <GitHubIcon className="aui-sidebar-footer-icon size-4" />
                                        </div><div className="aui-sidebar-footer-heading flex flex-col gap-0.5 leading-none">
                                          <span className="aui-sidebar-footer-title font-semibold">
                                            GitHub
                                          </span>
                                          <span>View Source</span>
                                        </div></SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </PulseBeam>
      <SidebarRail />
    </Sidebar>
  );
}
