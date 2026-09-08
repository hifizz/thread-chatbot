"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { ArrowUpIcon, PlusIcon, SquareIcon } from "lucide-react";
import { paper, ghostButton, inkButton, iconSwap, iconSwapIn, iconSwapOut } from "../surfaces";

export function Composer({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer"
      className={cn("relative w-full max-w-lg", className)}
      {...props}
    />
  );
}

export function ComposerBar({
  dragActive = false,
  className,
  ...props
}: ComponentProps<"div"> & { dragActive?: boolean }) {
  return (
    <div
      data-slot="composer-bar"
      data-drag-active={dragActive || undefined}
      className={cn(
        paper,
        "flex w-full flex-col gap-2 rounded-xl p-2.5 transition-colors bg-white",
        dragActive && "bg-blue-500/[0.04] dark:bg-blue-500/10",
        className,
      )}
      {...props}
    />
  );
}
export function ComposerToolbar({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-toolbar"
      className={cn("flex items-center justify-between", className)}
      {...props}
    />
  );
}

export function ComposerActions({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-actions"
      className={cn("flex items-center gap-1.5", className)}
      {...props}
    />
  );
}

export function ComposerAttachButton({
  className,
  ...props
}: Omit<ComponentProps<"button">, "children">) {
  return (
    <button
      type="button"
      aria-label="添加附件"
      data-slot="composer-attach"
      disabled={!props.onClick}
      className={cn(
        ghostButton,
        "size-8 disabled:pointer-events-none disabled:opacity-30",
        className,
      )}
      {...props}
    >
      <PlusIcon className="size-4" />
    </button>
  );
}
export function ComposerSend({
  streaming,
  idle,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  streaming: boolean;
  idle: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={streaming ? "停止生成" : "发送"}
      data-slot="composer-send"
      className={cn(
        "grid size-8 place-items-center rounded-full",
        streaming || !idle
          ? inkButton
          : "bg-foreground/[0.06] text-foreground/30 dark:bg-foreground/[0.09] transition-colors",
        className,
      )}
      {...props}
    >
      <ArrowUpIcon
        className={cn(iconSwap, "size-4", streaming ? iconSwapOut : iconSwapIn)}
      />
      <SquareIcon
        className={cn(
          iconSwap,
          "size-3 fill-current",
          streaming ? iconSwapIn : iconSwapOut,
        )}
      />
    </button>
  );
}
