import fs from "node:fs";
import path from "node:path";
import { ThinkingDemo } from "./thinking-demo";
import { ThinkingTraceFixture } from "./thinking-trace-fixture";

export default function BeautifulUiDemoPage() {
  // 与官方 gallery 一致：卡片「复制 / 查看代码」用的是组件源码本身。
  const code = fs.readFileSync(
    path.join(process.cwd(), "components", "primitives", "ThinkingState.tsx"),
    "utf8",
  );

  return (
    <main className="bui bui-scope min-h-dvh">
      <ThinkingDemo code={code} />
      <ThinkingTraceFixture />
    </main>
  );
}
