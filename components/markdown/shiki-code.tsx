"use client";

import {
  createElement,
  Fragment,
  memo,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { MarkdownShikiThemeMode } from "@/constants/markdown-syntax-highlighting";
import { normalizeMarkdownLanguage } from "@/lib/markdown/syntax-language";

export type ShikiCodeOutcome = "highlighted" | "plaintext";

export interface ShikiCodeProps {
  code: string;
  language?: string;
  meta?: string;
  streaming?: boolean;
  themeMode: MarkdownShikiThemeMode;
  onSettled?: (outcome: ShikiCodeOutcome) => void;
}

type HastProperty = boolean | number | string | null | undefined;

interface HastRoot {
  type: "root";
  children: HastNode[];
}

interface HastElement {
  type: "element";
  tagName: string;
  properties?: Record<string, HastProperty | HastProperty[]>;
  children: HastNode[];
}

interface HastText {
  type: "text";
  value: string;
}

type HastNode = HastRoot | HastElement | HastText;

interface HighlightState {
  hast: HastRoot | null;
  key: string;
  outcome: ShikiCodeOutcome;
}

const ALLOWED_SHIKI_TAGS = new Set(["code", "pre", "span"]);

function cssTextToReactStyle(cssText: string): CSSProperties {
  const style: Record<string, string> = {};

  for (const declaration of cssText.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (!property || !value) continue;

    const reactProperty = property.startsWith("--")
      ? property
      : property.replace(/-([a-z])/g, (_, letter: string) =>
          letter.toUpperCase(),
        );
    style[reactProperty] = value;
  }

  return style as CSSProperties;
}

function hastPropertiesToReact(
  properties: HastElement["properties"],
): Record<string, unknown> {
  if (!properties) return {};

  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(properties)) {
    if (value === null || value === undefined) continue;
    if (name === "class" || name === "className") {
      result.className = Array.isArray(value) ? value.join(" ") : value;
    } else if (name === "style" && typeof value === "string") {
      result.style = cssTextToReactStyle(value);
    } else if (name.toLowerCase() === "tabindex") {
      result.tabIndex = Number(value);
    } else if (name.startsWith("data-") || name.startsWith("aria-")) {
      result[name] = value;
    }
  }
  return result;
}

function hastToReact(node: HastNode, key: string): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type === "root") {
    return createElement(
      Fragment,
      { key },
      node.children.map((child, index) =>
        hastToReact(child, `${key}-${index}`),
      ),
    );
  }
  if (!ALLOWED_SHIKI_TAGS.has(node.tagName)) {
    return node.children.map((child, index) =>
      hastToReact(child, `${key}-${index}`),
    );
  }

  return createElement(
    node.tagName,
    {
      ...hastPropertiesToReact(node.properties),
      key,
    },
    node.children.map((child, index) =>
      hastToReact(child, `${key}-${index}`),
    ),
  );
}

function PlainCode({ code }: { code: string }) {
  return (
    <pre>
      <code>{code}</code>
    </pre>
  );
}

/**
 * 两条 Markdown renderer 复用的安全 token body。
 * Shiki 整个核心仅在稳定代码块出现后动态加载；HAST 只允许 pre/code/span，
 * 不生成或注入 raw HTML。
 */
export const ShikiCode = memo(function ShikiCode({
  code,
  language,
  meta,
  streaming = false,
  themeMode,
  onSettled,
}: ShikiCodeProps): ReactNode {
  const normalized = normalizeMarkdownLanguage(language);
  const [highlightState, setHighlightState] = useState<HighlightState | null>(
    null,
  );
  const renderKey = `${code}\u0000${normalized.language}\u0000${meta ?? ""}\u0000${themeMode}`;
  const currentState =
    highlightState?.key === renderKey ? highlightState : null;

  useEffect(() => {
    let current = true;

    if (streaming || normalized.language === "text") return;

    void import("@/lib/markdown/syntax-highlighting").then(
      async ({ highlightMarkdownCode }) => {
        const result = await highlightMarkdownCode({
          code,
          language,
          meta,
          themeMode,
          isCurrent: () => current,
        });
        if (!current || result.status === "stale") return;

        setHighlightState({
          hast: result.hast as HastRoot | null,
          key: renderKey,
          outcome:
            result.status === "highlighted" ? "highlighted" : "plaintext",
        });
      },
      () => {
        if (current) {
          setHighlightState({
            hast: null,
            key: renderKey,
            outcome: "plaintext",
          });
        }
      },
    );

    return () => {
      current = false;
    };
  }, [
    code,
    language,
    meta,
    normalized.language,
    renderKey,
    streaming,
    themeMode,
  ]);

  useEffect(() => {
    if (streaming) return;
    if (normalized.language === "text") {
      onSettled?.("plaintext");
    } else if (currentState) {
      onSettled?.(currentState.outcome);
    }
  }, [
    currentState,
    normalized.language,
    onSettled,
    streaming,
  ]);

  if (streaming || !currentState?.hast) return <PlainCode code={code} />;
  return <>{hastToReact(currentState.hast, "shiki")}</>;
});
