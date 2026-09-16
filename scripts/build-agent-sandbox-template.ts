// 构建 agent-demo 的 e2b 自定义模板：base 镜像 + 预装 devin CLI。
// 用法：pnpm agent-demo:build-template（需 E2B_API_KEY，经 --env-file=.env.local 注入）
// 构建后在 .env.local 设 E2B_TEMPLATE=devin-acp-agent 即可让任务走模板沙箱，
// 跳过每次任务里的 devin 下载安装（environment 阶段 17s -> ~5s）。

import { Template } from "e2b";

const TEMPLATE_NAME = "devin-acp-agent";

const template = Template()
  .fromBaseImage()
  // install.sh 末尾的交互式 `devin setup` 在构建环境必失败，但二进制已装好；
  // 构建以 root 执行，HOME 指到 /home/user 让二进制落在沙箱用户可预期路径。
  .runCmd("curl -fsSL https://cli.devin.ai/install.sh | HOME=/home/user bash || true")
  .runCmd("test -x /home/user/.local/bin/devin && /home/user/.local/bin/devin version")
  .runCmd("chown -R user:user /home/user/.local");

const info = await Template.build(template, TEMPLATE_NAME, {
  // base 沙箱默认 512MB，devin 跑 pnpm install 曾被 OOM——给到 2GB。
  memoryMB: 2048,
  onBuildLogs: (log) => process.stdout.write(`[build] ${String(log)}\n`),
});

console.log(`\n模板构建完成: ${info.name} (${info.templateId})`);
console.log(`在 .env.local 中加入：E2B_TEMPLATE=${TEMPLATE_NAME}`);
