'use client';
/**
 * 演示态 Artifact 卡：结构与工作台 orchestration/artifacts/markdown-artifact-card.tsx 对齐
 * （图标 + 标题 + kind 行 + 打开入口 + 深度色左缘；生成中为虚线占位卡 + 进度条）。
 * 打开只在本地展开正文，不导航、不请求。
 */
import { FileCode2, FileText, LoaderCircle } from "lucide-react";
import type { CSSProperties } from "react";
import {
  DEMO_ARTIFACT,
  DEMO_ARTIFACT_GENERATING,
  DEMO_ARTIFACT_KIND_LABEL,
  DEMO_ARTIFACT_OPEN_LABEL,
  DEMO_ARTIFACT_PARTIAL_RATIO,
} from "@/constants/landing-hero";

/** 生成中：只展示已生成的前一部分，字符 / 行数来自同一份正文，保证数字真实。 */
function partialProgress(content: string) {
  const partial = content.slice(0, Math.round(content.length * DEMO_ARTIFACT_PARTIAL_RATIO));
  const lines = partial.split("\n").filter((line) => line.trim() !== "");
  const headings = lines.filter((line) => line.startsWith("#")).map((line) => line.replace(/^#+\s*/, ""));
  return {
    characterCount: partial.length,
    lineCount: lines.length,
    headings: headings.length > 0 ? headings : [DEMO_ARTIFACT.title],
  };
}

export function DemoArtifactProgressCard({ accent }: { accent: string }) {
  const progress = partialProgress(DEMO_ARTIFACT.content);
  return (
    <div className="demo-acard demo-acard-progress" data-cursor-target="artifact-create"
      style={{ "--demo-accent": accent } as CSSProperties} role="status" aria-live="polite" aria-busy="true">
      <span className="demo-acard-icon">
        <span className="demo-progress-spinner"><LoaderCircle size={15} aria-hidden="true" /></span>
      </span>
      <span className="demo-acard-text">
        <span className="demo-acard-name">{DEMO_ARTIFACT_GENERATING}</span>
        <span className="demo-acard-kind demo-progress-detail">
          已生成 {progress.characterCount.toLocaleString()} 字符 · {progress.lineCount.toLocaleString()} 行
        </span>
        <span className="demo-progress-heading">最近章节 · {progress.headings.join(" / ")}</span>
        <span className="demo-progress-track" aria-hidden="true"><span /></span>
      </span>
      <span className="demo-acard-go">生成中</span>
    </div>
  );
}

export function DemoArtifactCard({
  accent, expanded, onOpen,
}:{
  accent: string; expanded: boolean; onOpen: () => void;
}) {
  return <div className="demo-artifact-wrap">
    <button type="button" className="demo-acard" style={{ "--demo-accent": accent } as CSSProperties}
      onClick={onOpen} aria-expanded={expanded} data-cursor-target="artifact-create">
      <span className="demo-acard-icon">
        {DEMO_ARTIFACT.kindLabel === DEMO_ARTIFACT_KIND_LABEL ? <FileText size={15} /> : <FileCode2 size={15} />}
      </span>
      <span className="demo-acard-text">
        <span className="demo-acard-name">{DEMO_ARTIFACT.title}</span>
        <span className="demo-acard-kind">{DEMO_ARTIFACT.kindLabel}</span>
      </span>
      <span className="demo-acard-go">{DEMO_ARTIFACT_OPEN_LABEL}</span>
    </button>
    {expanded ? (
      <div className="demo-artifact-content">
        {DEMO_ARTIFACT.content.split("\n").filter((line) => line.trim() !== "").map((line) => (
          <p key={line}>{line.replace(/^#+\s*/, "").replace(/^-\s*/, "")}</p>
        ))}
      </div>
    ) : null}
  </div>;
}
