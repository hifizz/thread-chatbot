"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { mono } from "../surfaces";
import { ComposerMenuItem } from "./menu";

export interface ComposerModel {
  name: string;
  meta: string;
  icon?: ReactNode;
}
export function ComposerModelTrigger({
  model,
  open,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  model: string;
  open: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      data-slot="composer-model-trigger"
      className={cn(
        "text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/90 dark:hover:bg-foreground/[0.09] flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors",
        className,
      )}
      {...props}
    >
      <span className="truncate" title={model}>{model}</span>
      <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
    </button>
  );
}

export function ComposerModelItem({
  entry,
  selected,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  entry: ComposerModel;
  selected: boolean;
}) {
  return (
    <ComposerMenuItem active={selected} {...props}>
      {entry.icon}
      <span className="min-w-0 flex-1 truncate text-start" title={entry.name}>{entry.name}</span>
      <span className={cn(mono, "shrink-0 text-foreground/35 tabular-nums")}>
        {entry.meta}
      </span>
      <span className="flex w-4 shrink-0 justify-end">
        {selected && (
          <CheckIcon className="fade-in zoom-in-90 animate-in size-3.5 duration-200" />
        )}
      </span>
    </ComposerMenuItem>
  );
}
