'use client';

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GitBranch, MessageSquareReply } from "lucide-react";
import { BUBBLE_SAFE_PADDING } from "@/constants/selection-bubble";
import {
  DEMO_BUBBLE_SAFE_PADDING,
  DEMO_BUBBLE_TITLE,
  DEMO_BUBBLE_W,
  DEMO_BRANCH_LABEL,
  DEMO_BRANCH_LABEL_TITLE,
  DEMO_FORK_LABEL,
  DEMO_FORK_LABEL_TITLE,
  DEMO_QUESTION_PLACEHOLDER,
  DEMO_SUBMIT_IDLE,
  DEMO_SUBMIT_WITH_QUESTION,
} from "@/constants/landing-hero";
import { previewDemoPlacement, type DemoPlacementHint, type DemoPlacementMode, type DemoSlot } from "./demo-placement";

export interface DemoSelection {
  laneIndex: number;
  text: string;
  rect: { left: number; top: number; width: number; height: number };
}

interface ToolbarProps {
  selection: DemoSelection;
  container: HTMLElement | null;
  onContinue: () => void;
  onBranch: () => void;
  onClose: () => void;
}

export function DemoSelectionToolbar({ selection, container, onContinue, onBranch, onClose }: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      if (!container) return;
      const box = container.getBoundingClientRect();
      const width = Math.min(260, window.innerWidth - DEMO_BUBBLE_SAFE_PADDING * 2);
      const height = ref.current?.offsetHeight ?? 44;
      let left = selection.rect.left - box.left + selection.rect.width / 2 - width / 2;
      left = Math.max(DEMO_BUBBLE_SAFE_PADDING, Math.min(left, box.width - width - DEMO_BUBBLE_SAFE_PADDING));
      let top = selection.rect.top - box.top - height - 10;
      if (top < DEMO_BUBBLE_SAFE_PADDING) top = selection.rect.top - box.top + selection.rect.height + 10;
      setPos({ left, top });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [selection, container]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="demo-selection-toolbar"
      role="toolbar"
      aria-label="划选文本操作"
      data-positioned={Boolean(pos)}
      style={{
        width: Math.min(260, typeof window === "undefined" ? 260 : window.innerWidth - BUBBLE_SAFE_PADDING * 2),
        left: pos?.left,
        top: pos?.top,
        visibility: pos ? "visible" : "hidden",
      }}
      onPointerDown={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        const buttons = Array.from(e.currentTarget.querySelectorAll("button"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (index + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        e.preventDefault();
        buttons[next]?.focus();
      }}
    >
      <button type="button" title={DEMO_BRANCH_LABEL_TITLE} data-cursor-target="demo-continue" onClick={onContinue}>
        <MessageSquareReply size={16} aria-hidden="true" />
        {DEMO_BRANCH_LABEL}
      </button>
      <button type="button" title={DEMO_FORK_LABEL_TITLE} data-cursor-target="demo-fork-open" onClick={onBranch}>
        <GitBranch size={16} aria-hidden="true" />
        {DEMO_FORK_LABEL}
      </button>
    </div>
  );
}

interface BubbleProps {
  selection: DemoSelection;
  container: HTMLElement | null;
  slots: DemoSlot[];
  mode: DemoPlacementMode;
  maxExpanded: number;
  lastActiveOf: (id: string) => number;
  titleOf: (id: string) => string;
  sourceId: string;
  onClose: () => void;
  onSubmit: (question: string, hint?: DemoPlacementHint) => void;
}

export function DemoQuestionBubble({
  selection,
  container,
  slots,
  mode,
  maxExpanded,
  lastActiveOf,
  titleOf,
  sourceId,
  onClose,
  onSubmit,
}: BubbleProps) {
  const [question, setQuestion] = useState("");
  const [override, setOverride] = useState<string | null>(null);
  const [metaHeld, setMetaHeld] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredH, setMeasuredH] = useState(0);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setMeasuredH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [question, slots.length, mode]);

  useEffect(() => {
    const sync = (e: KeyboardEvent) => setMetaHeld(e.metaKey || e.ctrlKey);
    document.addEventListener("keydown", sync);
    document.addEventListener("keyup", sync);
    return () => {
      document.removeEventListener("keydown", sync);
      document.removeEventListener("keyup", sync);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !question.trim()) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, question]);

  const hasQuestion = question.trim().length > 0;
  const ov = override && slots.some((s) => s.id === override && !s.folded) ? override : null;
  const hint: DemoPlacementHint | undefined = ov
    ? { targetId: ov }
    : metaHeld
      ? { keepSource: true }
      : undefined;
  const preview = slots.length > 0 ? previewDemoPlacement(mode, slots, { sourceId, maxExpanded, lastActiveOf, hint }) : null;
  const placeHint = ov
    ? `将${mode === "replace" ? "替换" : "折叠"}『${titleOf(ov)}』`
    : metaHeld
      ? "⌘ 保留本列 · 新列开在紧邻右侧"
      : preview?.replaceId
        ? `默认替换『${titleOf(preview.replaceId)}』（点小格可换）`
        : preview?.foldId
          ? `默认折叠『${titleOf(preview.foldId)}』（点小格可换）`
          : "将在右侧新开一列";

  const ready = measuredH > 0 && typeof window !== "undefined" && container;
  let left = -9999;
  let top = -9999;
  if (ready && container) {
    const box = container.getBoundingClientRect();
    const gap = 10;
    left = selection.rect.left - box.left + selection.rect.width / 2 - DEMO_BUBBLE_W / 2;
    left = Math.max(DEMO_BUBBLE_SAFE_PADDING, Math.min(left, box.width - DEMO_BUBBLE_W - DEMO_BUBBLE_SAFE_PADDING));
    const below = selection.rect.top - box.top + selection.rect.height + gap;
    const above = selection.rect.top - box.top - measuredH - gap;
    top = below + measuredH <= box.height - DEMO_BUBBLE_SAFE_PADDING ? below : Math.max(DEMO_BUBBLE_SAFE_PADDING, above);
  }

  const submit = (metaFromEvent: boolean) => {
    const h: DemoPlacementHint | undefined = ov
      ? { targetId: ov }
      : metaFromEvent || metaHeld
        ? { keepSource: true }
        : undefined;
    window.getSelection()?.removeAllRanges();
    onSubmit(question.trim(), h);
  };

  return (
    <div
      className="demo-question-bubble"
      style={{ left, top, width: DEMO_BUBBLE_W, visibility: ready ? "visible" : "hidden" }}
    >
      <div className="demo-question-content" ref={contentRef}>
        <div className="demo-question-label">{DEMO_BUBBLE_TITLE}</div>
        <div className="demo-question-quote">{selection.text}</div>
        <div className="demo-question-ask">
          <textarea
            rows={1}
            value={question}
            placeholder={DEMO_QUESTION_PLACEHOLDER}
            aria-label="就这段划选文字提出你的问题（可留空，留空则预填代拟问题待确认）"
            onChange={(e) => {
              setQuestion(e.target.value);
              const ta = e.currentTarget;
              ta.style.height = "auto";
              ta.style.height = `${Math.min(ta.scrollHeight + 2, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (e.nativeEvent.isComposing) return;
              if (e.shiftKey) return;
              e.preventDefault();
              submit(e.metaKey || e.ctrlKey);
            }}
          />
        </div>
        {preview ? (
          <div className="demo-slotmap" aria-hidden="true">
            <span className="demo-smcell demo-main" title="主线" />
            {slots.map((s) => (
              <button
                key={s.id}
                type="button"
                tabIndex={-1}
                title={titleOf(s.id)}
                className={[
                  "demo-smcell",
                  s.folded ? "demo-folded" : "",
                  preview.replaceId === s.id ? "demo-will-replace" : "",
                  preview.foldId === s.id ? "demo-will-fold" : "",
                  ov === s.id ? "demo-ov" : "",
                ].join(" ")}
                onClick={() => setOverride((cur) => (cur === s.id ? null : s.id))}
              />
            ))}
            <span className="demo-smcell demo-ghost">＋</span>
          </div>
        ) : null}
        <div className="demo-place-hint" aria-live="polite">
          {placeHint}
        </div>
        <button type="button" data-cursor-target="fork-submit" onClick={(e) => submit(e.metaKey || e.ctrlKey)}>
          <GitBranch size={14} />
          {hasQuestion ? DEMO_SUBMIT_WITH_QUESTION : DEMO_SUBMIT_IDLE}
        </button>
      </div>
    </div>
  );
}
