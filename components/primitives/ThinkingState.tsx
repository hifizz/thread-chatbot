"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, FilePenLine } from "lucide-react";

/* ─────────────────────────────────────────────────────────
 * THINKING — expandable agent trace, four variants
 *
 *   Steps      step list with spinner → muted checks
 *   Reasoning  prose reasoning that expands, then settles
 *   Search     web-search trace: query + sources read
 *   Coding     tool trace: files read, edits, commands
 *
 * The trace runs once, settles, and remains expandable.
 * ───────────────────────────────────────────────────────── */

const STAGES = [800, 600, 1800, 2600, 1600];

function useSequence(steps: number[]) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (stage >= steps.length - 1) return;
    const t = setTimeout(() => setStage((s) => s + 1), steps[stage]);
    return () => clearTimeout(t);
  }, [stage, steps]);
  return stage;
}

type Row = {
  primary: string;
  secondary?: string;
  mono?: boolean;
  add?: number;
  del?: number;
  href?: string;
  icon?: "book-open" | "search" | "file-pen";
  /** row is in-flight: leading glyph becomes a spinner */
  running?: boolean;
  /** row failed: glyph and secondary text take the danger tone */
  failed?: boolean;
  /** de-emphasized primary text (e.g. echoed search queries) */
  subtle?: boolean;
};

const VARIANTS: Record<
  string,
  { active: string; done: string; rows: Row[]; query?: string }
> = {
  Steps: {
    active: "Thinking",
    done: "Thought for 4 seconds",
    rows: [
      { primary: "Reading flavor briefs" },
      { primary: "Scanning supplier lists" },
      { primary: "Comparing tasting notes", secondary: "6 flavors" },
      { primary: "Writing the scoop report" },
    ],
  },
  Reasoning: {
    active: "Thinking",
    done: "Thought for 4 seconds",
    rows: [
      { primary: "Summer demand spikes for stone-fruit flavors — peach and apricot lead." },
      { primary: "I should check cone inventory before promoting a waffle-bowl special." },
    ],
  },
  Search: {
    active: "Searching the web",
    done: "Searched the web",
    query: "best waffle cone supplier",
    rows: [
      { primary: "Joy Cone", secondary: "joycone.com", href: "https://joycone.com/fs_products/waffle-cones/" },
      { primary: "WebstaurantStore", secondary: "webstaurantstore.com", href: "https://www.webstaurantstore.com/ice-cream-shop-supplies.html" },
      { primary: "The Konery", secondary: "thekonery.com", href: "https://www.thekonery.com/" },
    ],
  },
  Coding: {
    active: "Running tools",
    done: "Ran 3 tools",
    rows: [
      { primary: "Read", secondary: "flavors.ts", mono: true },
      { primary: "Edit", secondary: "ChurnSchedule.tsx", mono: true, add: 74, del: 41 },
      { primary: "Run", secondary: "npm run freeze", mono: true },
    ],
  },
};

function Dot({ tone }: { tone: string }) {
  return (
    <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-full text-white ${tone}`}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="9" />
        <path d="M3.5 12h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
    </span>
  );
}

const TONES = ["bg-accent", "bg-orange", "bg-green"];

function Spinner() {
  return (
    <span className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: "spin 700ms linear infinite" }} />
  );
}

/** 站点真实 favicon（直连目标站 /favicon.ico），加载失败回退到彩色圆点。 */
export function TraceFavicon({
  href,
  tone,
  className,
}: {
  href?: string;
  tone?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const origin = useMemo(() => {
    if (!href) return null;
    try {
      return new URL(href).origin;
    } catch {
      return null;
    }
  }, [href]);
  if (!origin || failed) return <Dot tone={tone ?? TONES[0]} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 任意域名 favicon 无法用 next/image remotePatterns 收敛
    <img
      src={`${origin}/favicon.ico`}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className ?? "size-3.5 shrink-0 rounded-[4px]"}
    />
  );
}

export default function ThinkingState({
  variant = "Steps",
  onSettled,
  rows,
  active,
  done,
  icon,
  working: workingProp,
  query: queryProp,
  renderPrimary,
  body,
  revision,
}: {
  variant?: string;
  onSettled?: () => void;
  /** override the built-in trace content (keeps the primitive reusable) */
  rows?: Row[];
  active?: string;
  done?: string;
  /** override the header glyph (defaults to the sparkle) */
  icon?: ReactNode;
  /** controlled run state: when provided, the built-in stage timer is bypassed
   *  (the gallery demo never passes it and keeps its scripted playback) */
  working?: boolean;
  /** Search query override (the built-in query only comes from VARIANTS) */
  query?: string;
  /** optional row-primary renderer (e.g. inline markdown for reasoning rows);
   *  keeps data formatting in the host adapter */
  renderPrimary?: (row: Row) => ReactNode;
  /** replaces the row list inside the expandable scroll area (e.g. a live
   *  streaming preview window); pair with `revision` so scroll/shadow resync */
  body?: ReactNode;
  /** opaque change key for `body` content; rows revisions are derived
   *  automatically, body content is opaque so the host supplies the key */
  revision?: string;
}) {
  const sequenced = useSequence(STAGES);
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const base = VARIANTS[variant] ?? VARIANTS.Steps;
  const controlled = workingProp !== undefined;
  const v = {
    ...base,
    rows: rows ?? base.rows,
    active: active ?? base.active,
    done: done ?? base.done,
    /* 受控模式（生产挂载）不回退到内置演示 query：没传 query 就不渲染查询词行 */
    query: queryProp ?? (controlled ? undefined : base.query),
  };
  const stage = controlled ? (workingProp ? 3 : 4) : sequenced;
  const autoExpanded = stage >= 1 && stage < 4;
  const expanded = manualExpanded ?? autoExpanded;
  const working = controlled ? workingProp : stage < 3;
  const visible = stage < 2 ? 0 : stage === 2 ? Math.min(2, v.rows.length) : v.rows.length;
  const contentRevision = revision ?? JSON.stringify(v.rows.slice(0, visible));
  const traceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [overflow, setOverflow] = useState(false);
  const [shadowTop, setShadowTop] = useState(false);
  const [shadowBottom, setShadowBottom] = useState(false);
  const [lineHeight, setLineHeight] = useState(0);
  useLayoutEffect(() => {
    if (!traceRef.current) return;
    const nextLineHeight = scrollRef.current
      ? scrollRef.current.clientHeight
      : traceRef.current.offsetHeight;
    setLineHeight((current) =>
      current === nextLineHeight ? current : nextLineHeight
    );
  }, [visible, expanded, variant, stage, controlled]);
  const syncScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    /* 只有真正溢出才有滚动与阴影：短内容自然展开，不出现滚动条也不做暗示。
     * 用内容自然高度判定（而非容器自身比较），否则 max-height 未生效时永远检不出溢出。 */
    const contentHeight = traceRef.current?.offsetHeight ?? el.scrollHeight;
    const nextOverflow = contentHeight > 256 + 1;
    const nextShadowTop = nextOverflow && el.scrollTop > 1;
    const nextShadowBottom =
      nextOverflow && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    const nextLineHeight = el.clientHeight;
    setOverflow((current) =>
      current === nextOverflow ? current : nextOverflow
    );
    setShadowTop((current) =>
      current === nextShadowTop ? current : nextShadowTop
    );
    setShadowBottom((current) =>
      current === nextShadowBottom ? current : nextShadowBottom
    );
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    /* 封顶生效后 clientHeight 会变化，竖线高度跟随可见区 */
    setLineHeight((current) =>
      current === nextLineHeight ? current : nextLineHeight
    );
  }, []);

  /* let embedders sequence content after the trace settles */
  const settledRef = useRef(false);
  useEffect(() => {
    if (working || settledRef.current) return;
    settledRef.current = true;
    if (controlled && scrollRef.current) {
      /* 结束后回到顶部；再次手动展开时从头阅读 */
      scrollRef.current.scrollTop = 0;
      pinnedRef.current = true;
      syncScroll();
    }
    onSettled?.();
  }, [working, onSettled, controlled, syncScroll]);

  /* 受控模式（生产挂载）：仅在内容或展开状态变化时贴底并同步测量。 */
  useEffect(() => {
    if (!controlled) return;
    const el = scrollRef.current;
    if (!el) return;
    if (working && pinnedRef.current) el.scrollTop = el.scrollHeight;
    syncScroll();
  }, [contentRevision, controlled, expanded, syncScroll, working]);
  useEffect(() => {
    if (!controlled || !expanded) return;
    const t = setTimeout(() => {
      const el = scrollRef.current;
      if (el && working && pinnedRef.current) el.scrollTop = el.scrollHeight;
      syncScroll();
    }, 450);
    return () => clearTimeout(t);
  }, [controlled, expanded, working, syncScroll]);

  return (
    <div
      key={variant}
      className={controlled ? "flex w-full flex-col" : "flex w-full max-w-95 flex-col"}
      style={{
        minHeight: !controlled && (working || expanded) ? 176 : undefined,
        transition: "min-height 400ms cubic-bezier(0.23,1,0.32,1)",
      }}
    >
      {/* header — shared across variants */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((current) => !(current ?? autoExpanded))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1
          transition-colors duration-100 hover:bg-hover-2"
      >
        {icon ? (
          <span className="flex shrink-0 transition-colors duration-200" style={{ color: working ? "var(--ink-2)" : "var(--ink-3)" }}>
            {icon}
          </span>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill={working ? "var(--ink-2)" : "var(--ink-3)"}>
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
          </svg>
        )}
        <span role="status" className="contents">
          {working ? (
            <span
              className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
                backgroundSize: "200% 100%",
                animation: "shimmer-text 1.4s linear infinite",
              }}
            >
              {v.active}
            </span>
          ) : (
            <span
              className="text-[13px] font-medium whitespace-nowrap text-ink-2"
              style={{ animation: "fade-in 350ms ease-out both" }}
            >
              {v.done}
            </span>
          )}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className="transition-transform duration-300"
          style={{ transform: expanded ? "rotate(0)" : "rotate(-90deg)" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* expandable trace */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-line"
              style={{ top: -8, height: lineHeight ? lineHeight - 2 : 0, transition: "height 500ms cubic-bezier(0.23,1,0.32,1)" }}
            />
            <div
              ref={scrollRef}
              className="thinking-scroll"
              onScroll={syncScroll}
              data-overflow={overflow || undefined}
              data-shadow-top={shadowTop || undefined}
              data-shadow-bottom={shadowBottom || undefined}
            >
                <div ref={traceRef} className="flex flex-col gap-1 py-1">
            {body ?? (<>
            {v.query && (
              <div className="flex h-6 items-center gap-2 px-1.5" style={{ animation: expanded ? "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" : undefined }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" className="shrink-0">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
                <span className="text-[12.5px] text-ink-2">{v.query}</span>
              </div>
            )}
            {v.rows.slice(0, visible).map((row, i) => {
              const content = (
                <>
                {variant === "Search" && (
                  row.running ? (
                    <Spinner />
                  ) : row.icon === "file-pen" ? (
                    <FilePenLine aria-hidden className={`size-3.5 shrink-0 ${row.failed ? "text-red" : "text-ink-3"}`} />
                  ) : row.icon === "book-open" ? (
                    <BookOpen aria-hidden className={`size-3.5 shrink-0 ${row.failed ? "text-red" : "text-ink-3"}`} />
                  ) : row.icon === "search" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={row.failed ? "var(--red)" : "var(--ink-3)"} strokeWidth="2" strokeLinecap="round" className="shrink-0">
                      <circle cx="11" cy="11" r="7" />
                      <path d="M21 21l-4.3-4.3" />
                    </svg>
                  ) : (
                    <TraceFavicon href={row.href} tone={TONES[i % 3]} />
                  )
                )}
                {variant === "Steps" && (
                  i < visible - 1 || !working ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    <Spinner />
                  )
                )}
                <span className={`min-w-0 truncate text-[12.5px] ${variant === "Reasoning" ? "whitespace-pre-wrap leading-relaxed text-ink-2" : row.subtle ? "text-ink-2" : "font-medium text-ink"} ${variant === "Search" && row.href ? "animated-underline" : ""}`}>
                  {renderPrimary ? renderPrimary(row) : row.primary}
                </span>
                {row.secondary && (
                  <span className={`shrink-0 max-w-[45%] truncate text-[11.5px] ${row.failed ? "text-red" : "text-ink-3"} ${row.mono ? "font-mono" : ""}`}>
                    {row.secondary}
                  </span>
                )}
                {row.add !== undefined && (
                  <span className="shrink-0 font-mono text-[11px] tabular-nums">
                    <span className="text-green">+{row.add}</span>{" "}
                    <span className="text-red">−{row.del}</span>
                  </span>
                )}
                </>
              );
              const rowClass = "flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left";
              const animation = { animation: `fade-up 320ms cubic-bezier(0.23,1,0.32,1) ${Math.min(i, 6) * 120}ms both` };

              if (variant === "Search") {
                if (!row.href) {
                  return (
                    <div key={i} className={rowClass} style={animation}>
                      {content}
                    </div>
                  );
                }
                return (
                  <a
                    key={i}
                    href={row.href}
                    target="_blank"
                    rel="noreferrer"
                    className={`${rowClass} transition-colors duration-150 hover:bg-hover`}
                    style={animation}
                  >
                    {content}
                  </a>
                );
              }

              if (variant === "Coding") {
                const selected = selectedTool === row.primary;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedTool(selected ? null : row.primary)}
                    className={`${rowClass} transition-colors duration-150 ${selected ? "bg-inset" : "hover:bg-hover"}`}
                    style={animation}
                  >
                    {content}
                  </button>
                );
              }

              return (
                <div key={i} className={rowClass} style={animation}>
                  {content}
                </div>
              );
            })}
            {variant === "Search" && !controlled && stage >= 3 && (
              <span className="text-[12px] text-ink-3" style={{ animation: "fade-in 300ms ease-out both" }}>
                +7 more
              </span>
            )}
            </>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
