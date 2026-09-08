"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { MicIcon, SquareIcon } from "lucide-react";
import { ghostButton, inkButton, mono, ShimmerLabel } from "../surfaces";

const BARS = Array.from({ length: 14 }, (_, i) => i);

function barHeight(bar: number, tick: number): number {
  return 5 + Math.abs(Math.sin(bar * 1.35 + tick * 0.55)) * 13;
}
export function ComposerVoice({
  recording,
  seconds,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  recording: boolean;
  seconds: number;
}) {
  return (
    <div
      data-slot="composer-voice"
      data-recording={recording || undefined}
      className={cn("flex min-h-11 items-center gap-3 ps-3", className)}
      {...props}
    >
      {recording && (
        <span
          aria-hidden
          className="size-1.5 animate-pulse rounded-full bg-blue-500 dark:bg-blue-400"
        />
      )}
      <div className="flex h-6 items-center gap-[3px]" aria-hidden>
        {BARS.map((bar) => (
          <span
            key={bar}
            className={cn(
              "w-0.5 rounded-full transition-[height,background-color] duration-150 motion-reduce:transition-none",
              recording ? "bg-foreground/50" : "bg-foreground/25",
            )}
            style={{ height: recording ? barHeight(bar, seconds * 10) : 3 }}
          />
        ))}
      </div>
      {recording ? (
        <span className={cn(mono, "text-foreground/40 tabular-nums")}>
          0:{String(seconds).padStart(2, "0")}
        </span>
      ) : (
        <ShimmerLabel className="text-foreground/55 relative text-[13px]">
          Transcribing
        </ShimmerLabel>
      )}
    </div>
  );
}
export function ComposerVoiceButton({
  active,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-label={active ? "Stop recording" : "Start voice input"}
      data-slot="composer-voice-button"
      className={cn(
        active
          ? cn(
              inkButton,
              "flex size-8 items-center justify-center rounded-full",
            )
          : cn(ghostButton, "size-8"),
        className,
      )}
      {...props}
    >
      {active ? (
        <SquareIcon className="size-3 fill-current" />
      ) : (
        <MicIcon className="size-4" />
      )}
    </button>
  );
}
