import type { ReactNode } from "react";
import { JetBrains_Mono } from "next/font/google";

// 官方 demo 的 mono 字面是 JetBrains Mono，foundation 通过 --font-mono-face 引用。
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face" });

export default function BeautifulUiDemoLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div className={mono.variable}>{children}</div>;
}
