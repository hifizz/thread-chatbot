"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { CheckIcon, FileArchiveIcon, FileImageIcon, FileTextIcon, Loader2Icon, XIcon, type LucideIcon } from "lucide-react";
import { field, ghostButton } from "../surfaces";
import { pct } from "../../utils/range";

export interface ComposerAttachment {
  name: string;
  meta: string;
  state: "uploading" | "done" | "error";
  progress?: number;
  kind?: "image" | "text" | "archive";
}
const ATTACHMENT_ICONS: Record<
  NonNullable<ComposerAttachment["kind"]>,
  LucideIcon
> = {
  image: FileImageIcon,
  text: FileTextIcon,
  archive: FileArchiveIcon,
};
export function ComposerAttachments({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-attachments"
      className={cn("flex flex-wrap gap-2", className)}
      {...props}
    />
  );
}

export function ComposerAttachmentChip({
  attachment,
  onRemove,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  attachment: ComposerAttachment;
  onRemove?: (name: string) => void;
}) {
  const Icon = ATTACHMENT_ICONS[attachment.kind ?? "text"];
  return (
    <div
      data-slot="composer-attachment"
      data-state={attachment.state}
      className={cn(
        field,
        "relative flex items-center gap-2.5 overflow-hidden rounded-[14px] py-1.5 ps-1.5 pe-2.5",
        className,
      )}
      {...props}
    >
      <span className="bg-background text-foreground/45 flex size-8 shrink-0 items-center justify-center rounded-[10px] dark:bg-white/10">
        <Icon className="size-4" />
      </span>
      <span className="flex flex-col">
        <span className="max-w-36 truncate text-xs font-medium">
          {attachment.name}
        </span>
        <span
          className={cn(
            "text-[11px]",
            attachment.state === "error"
              ? "text-red-600/80 dark:text-red-400/80"
              : "text-foreground/40",
          )}
        >
          {attachment.meta}
        </span>
      </span>
      <span className="ms-1 flex w-5 items-center justify-end">
        {attachment.state === "uploading" ? (
          <Loader2Icon className="text-foreground/35 size-3.5 animate-spin motion-reduce:animate-none" />
        ) : attachment.state === "done" && onRemove ? (
          <button
            type="button"
            aria-label={`移除 ${attachment.name}`}
            onClick={() => onRemove(attachment.name)}
            className={cn(ghostButton, "size-5 [&_svg]:size-3")}
          >
            <XIcon />
          </button>
        ) : attachment.state === "done" ? (
          <CheckIcon className="size-3.5 text-emerald-500" />
        ) : null}
      </span>
      {attachment.state === "uploading" && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-500/70 transition-[width] duration-300 dark:bg-blue-400/70"
          style={{ width: `${pct(attachment.progress ?? 0, 100)}%` }}
        />
      )}
    </div>
  );
}
