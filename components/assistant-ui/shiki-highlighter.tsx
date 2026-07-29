"use client";

import { INTERNAL } from "@assistant-ui/react";
import type { SyntaxHighlighterProps as AssistantSyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import { useTheme } from "next-themes";
import type { FC } from "react";

import { ShikiCode } from "@/components/markdown/shiki-code";
import { cn } from "@/lib/utils";

export type HighlighterProps = AssistantSyntaxHighlighterProps;

const containerClassName =
  "aui-shiki-base [&_pre]:border-muted-foreground/20 [&_pre]:bg-muted/30! [&_.line]:px-0! [&_pre]:overflow-x-auto [&_pre]:rounded-t-none [&_pre]:rounded-b-xl [&_pre]:border [&_pre]:border-t-0 [&_pre]:p-3.5 [&_pre]:text-[13px] [&_pre]:leading-relaxed";

/**
 * assistant-ui 的 fenced-code adapter。
 * 平滑显示层仍在追帧时只渲染 plaintext；真正稳定后才交给共享 Shiki 核心。
 */
export const SyntaxHighlighter: FC<HighlighterProps> = ({
  code,
  language,
  node,
}) => {
  const smoothStatus = INTERNAL.useSmoothStatus();
  const isStreaming = smoothStatus.type === "running";
  const { resolvedTheme } = useTheme();
  const themeMode = resolvedTheme === "dark" ? "dark" : "light";
  const metaValue = (node?.data as { meta?: unknown } | undefined)?.meta;
  const meta = typeof metaValue === "string" ? metaValue : undefined;

  return (
    <div
      className={cn(containerClassName, isStreaming && "aui-shiki-streaming")}
    >
      <ShikiCode
        code={code}
        language={language}
        meta={meta}
        streaming={isStreaming}
        themeMode={themeMode}
      />
    </div>
  );
};

SyntaxHighlighter.displayName = "SyntaxHighlighter";
