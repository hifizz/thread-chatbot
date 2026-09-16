'use client';

import { useState } from "react";
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  DEMO_COPIED_LABEL,
  DEMO_COPY_FAILED,
  DEMO_COPY_LABEL,
  DEMO_FEEDBACK_FAILED,
  DEMO_MESSAGE_TOOLBAR_LABEL,
  DEMO_NEGATIVE_LABEL,
  DEMO_NO_MARKDOWN,
  DEMO_POSITIVE_LABEL,
  DEMO_REGENERATE_LABEL,
  DEMO_REGENERATE_ONLY_LATEST,
} from "@/constants/landing-hero";

export function DemoMessageToolbar({
  laneTitle,
  text,
  regeneratable,
  feedback,
  onFeedback,
  onRegenerate,
}: {
  laneTitle: string;
  text: string;
  regeneratable: boolean;
  feedback: "positive" | "negative" | null;
  onFeedback: (next: "positive" | "negative" | null) => void;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    if (!text.trim()) {
      setError(DEMO_NO_MARKDOWN);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setError(null);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(DEMO_COPY_FAILED);
    }
  };

  const regenerate = () => {
    if (!regeneratable || busy) return;
    setBusy(true);
    setError(null);
    try {
      onRegenerate();
    } finally {
      window.setTimeout(() => setBusy(false), 1200);
    }
  };

  const rate = (next: "positive" | "negative") => {
    try {
      onFeedback(feedback === next ? null : next);
      setError(null);
    } catch {
      setError(DEMO_FEEDBACK_FAILED);
    }
  };

  const actions = [
    {
      key: "copy",
      label: copied ? DEMO_COPIED_LABEL : DEMO_COPY_LABEL,
      title: copied ? DEMO_COPIED_LABEL : DEMO_COPY_LABEL,
      icon: copied ? Check : Copy,
      onClick: () => void copy(),
      disabled: false,
      pressed: false,
    },
    {
      key: "regenerate",
      label: DEMO_REGENERATE_LABEL,
      title: regeneratable ? DEMO_REGENERATE_LABEL : DEMO_REGENERATE_ONLY_LATEST,
      icon: RotateCcw,
      onClick: regenerate,
      disabled: !regeneratable || busy,
      pressed: false,
    },
    {
      key: "positive",
      label: DEMO_POSITIVE_LABEL,
      title: DEMO_POSITIVE_LABEL,
      icon: ThumbsUp,
      onClick: () => rate("positive"),
      disabled: false,
      pressed: feedback === "positive",
    },
    {
      key: "negative",
      label: DEMO_NEGATIVE_LABEL,
      title: DEMO_NEGATIVE_LABEL,
      icon: ThumbsDown,
      onClick: () => rate("negative"),
      disabled: false,
      pressed: feedback === "negative",
    },
  ];

  return (
    <div>
      <div className="demo-message-toolbar" role="toolbar" aria-label={`${DEMO_MESSAGE_TOOLBAR_LABEL} · ${laneTitle}`}>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.key}
              type="button"
              className="demo-message-action"
              aria-label={action.label}
              title={action.title}
              aria-pressed={action.pressed || undefined}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              <Icon size={14} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {error ? (
        <div className="demo-message-action-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
