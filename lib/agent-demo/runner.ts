// Agent runner：按方案 §2 的步骤推进一个 Run。
// demo 形态：Agent 循环跑在本进程（AI SDK streamText），执行环境是真实 boxd VM，
// 仓库操作用 GITHUB_TOKEN，发布为固定任务分支 + Draft PR（GitHub REST，带查重）。

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isStepCount, streamText, type LanguageModel } from "ai";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Sandbox } from "e2b";
import { AcpBridge } from "@/lib/agent-demo/acp";
import type { TaskResult } from "@/lib/agent-demo/contracts";
import {
  createBoxdEnvironment,
  createE2bEnvironment,
  installDevinHarness,
  LocalDriver,
  type WorkspaceDriver,
} from "@/lib/agent-demo/environment";
import { publishDraftPr } from "@/lib/agent-demo/github";
import { emit, getTask, isCancelRequested, registerRunHandles, registerSecret, setRunStatus } from "@/lib/agent-demo/store";
import { createWorkspaceTools } from "@/lib/agent-demo/tools";

const MAX_STEPS = 20;
const MAX_OUTPUT_TOKENS = 16_000;
// 任务级时长预算：默认 3 小时，可经 AGENT_TASK_TIME_BUDGET_MINUTES 调整。
// e2b 沙箱 TTL 由续期心跳滚动维持（不再是 58min 硬顶），此预算是任务自身
// 的护栏：到点中止 Agent 但不丢弃产出——继续走 verify/publish 交付为 partial。
const TASK_TIME_BUDGET_MS =
  (Number(process.env.AGENT_TASK_TIME_BUDGET_MINUTES) || 180) * 60 * 1000;

function phase(taskId: string, phase: string, label: string) {
  emit(taskId, "runner", { type: "phase.changed", phase, label });
}

function fail(taskId: string, code: string, source: "task" | "environment" | "runner", message: string) {
  emit(taskId, "runner", {
    type: "run.error",
    error: { code, source, userMessage: message },
  });
  setRunStatus(taskId, "failed");
}

/** Agent 使用的模型渠道：AGENT_MODEL_* 环境变量（OpenAI-compatible）。 */
function resolveAgentModel(): LanguageModel {
  const baseURL = process.env.AGENT_MODEL_BASE_URL?.trim();
  const apiKey = process.env.AGENT_MODEL_API_KEY?.trim();
  const modelId = process.env.AGENT_MODEL_ID?.trim();
  if (!baseURL || !apiKey || !modelId) {
    throw new Error("AGENT_MODEL_BASE_URL / AGENT_MODEL_API_KEY / AGENT_MODEL_ID 未配置");
  }
  const provider = createOpenAICompatible({
    name: "agent-model",
    baseURL,
    apiKey,
    transformRequestBody: (body) => {
      // gpt-5.x 走 max_completion_tokens（与 Token Router 的归一化规则一致）
      if (typeof body.model === "string" && body.model.startsWith("gpt-")) {
        const { max_tokens, ...rest } = body;
        return { ...rest, ...(max_tokens !== undefined ? { max_completion_tokens: max_tokens } : {}) };
      }
      return body;
    },
  });
  return provider(modelId);
}

const SYSTEM_PROMPT = `你是 ThreadChat 的编码 Agent，在一个受限的远端沙箱工作区中工作，工作区是用户 GitHub 仓库的任务分支检出。

规则：
- 先用 list_files / read_file 了解仓库结构和相关内容。
- 只能用提供的工具读写文件和执行命令；不要臆造文件内容。
- run_command 只有只读与构建测试类命令；git 只允许只读子命令。commit、push、PR 由系统在核实后统一执行，不需要你做。
- 需要交付文件时用 write_file 写入仓库内合适的位置。
- 完成后用中文简要总结你做了什么、产出哪些文件、如何验证。
- 不要执行与目标无关的操作，不要尝试访问仓库以外的路径。`;

export function startRunner(taskId: string) {
  void runTask(taskId).catch((error) => {
    console.error("[agent-demo] runner 异常:", error);
    const task = getTask(taskId);
    if (task && task.status !== "completed" && task.status !== "failed") {
      fail(taskId, "runner_crashed", "runner", error instanceof Error ? error.message : String(error));
    }
  });
}

async function runTask(taskId: string) {
  const task = getTask(taskId);
  if (!task) return;

  setRunStatus(taskId, "running");
  let release: (() => Promise<void>) | null = null;
  const abortController = new AbortController();
  registerRunHandles(taskId, { abortController });
  // 超时预算：到点中止 Agent（ACP 路径经 abort 监听器发 session/cancel），
  // 但不丢弃已产出内容——继续走 verify/publish，交付为 partial。
  // 预算按"剩余时间"记账：暂停时冻结剩余额度，恢复后重新起表。
  let timedOut = false;
  let deadlineRemainingMs = TASK_TIME_BUDGET_MS;
  let deadlineStartedAt = Date.now();
  const armDeadline = () =>
    setTimeout(() => {
      timedOut = true;
      phase(taskId, "agent", `已超过 ${TASK_TIME_BUDGET_MS / 60000} 分钟预算，中止 Agent 并收尾已有产出`);
      abortController.abort();
    }, deadlineRemainingMs);
  let deadline = armDeadline();
  const pauseDeadline = () => {
    deadlineRemainingMs = Math.max(0, deadlineRemainingMs - (Date.now() - deadlineStartedAt));
    clearTimeout(deadline);
  };
  const resumeDeadline = () => {
    deadlineStartedAt = Date.now();
    deadline = armDeadline();
  };

  try {
    // ── 环境准备：远端沙箱 + 仓库检出（e2b 优先，boxd 次之）─────────
    phase(taskId, "environment", "准备执行环境");
    const githubToken = process.env.GITHUB_TOKEN?.trim();
    const remoteReady = Boolean(githubToken) &&
      (Boolean(process.env.E2B_API_KEY?.trim()) || Boolean(process.env.BOXD_API_KEY?.trim()));

    let driver: WorkspaceDriver;
    let e2bSandbox: Sandbox | null = null;
    let e2bPause: (() => Promise<void>) | null = null;
    let e2bResume: (() => Promise<void>) | null = null;
    let acp: AcpBridge | null = null;
    if (remoteReady) {
      if (process.env.E2B_API_KEY?.trim()) {
        const env = await createE2bEnvironment({
          taskId: task.id,
          repo: task.repo,
          branch: task.branch,
          baseBranch: task.baseBranch,
          githubToken: githubToken!,
          onPhase: (label) => phase(taskId, "environment", label),
        });
        driver = env.driver;
        e2bSandbox = env.sandbox;
        e2bPause = env.pause;
        e2bResume = env.resume;
        release = env.release;
        registerRunHandles(taskId, { releaseEnv: env.release, sandboxId: env.sandboxId });
        emit(taskId, "runner", {
          type: "phase.changed",
          phase: "environment",
          label: `e2b 沙箱就绪：${env.sandboxId}`,
        });
      } else {
        const env = await createBoxdEnvironment({
          taskId: task.id,
          repo: task.repo,
          branch: task.branch,
          baseBranch: task.baseBranch,
          githubToken: githubToken!,
          onPhase: (label) => phase(taskId, "environment", label),
        });
        driver = env.driver;
        release = env.release;
        registerRunHandles(taskId, { releaseEnv: env.release });
        emit(taskId, "runner", {
          type: "phase.changed",
          phase: "environment",
          label: `boxd 机器就绪：${env.machine.name} (${env.machine.access.url})`,
        });
      }
    } else {
      driver = new LocalDriver(task.workspacePath);
    }
    const filesBefore = new Set(await driver.listFiles().catch(() => [] as string[]));

    // ── Harness：e2b 路径下在沙箱内安装并启动 devin acp ──────────
    if (e2bSandbox) {
      phase(taskId, "environment", "安装 devin CLI");
      const cred = await readFile(
        path.join(os.homedir(), ".local/share/devin/credentials.toml"),
        "utf8"
      ).catch(() => null);
      if (!cred) throw new Error("本机 devin CLI 未登录（缺 credentials.toml）");
      registerSecret(cred.match(/windsurf_api_key\s*=\s*"([^"]+)"/)?.[1]);
      const devinBin = await installDevinHarness(e2bSandbox, cred);
      phase(taskId, "environment", "启动 devin ACP 会话");
      acp = await AcpBridge.start({
        sandbox: e2bSandbox,
        cwd: driver.workdir,
        devinBin,
        emitEvent: (payload) => emit(taskId, "agent", payload),
      });
      abortController.signal.addEventListener("abort", () => void acp?.cancel());
      // 暂停/恢复钩子：沙箱整体快照，runner 挂在 acp.prompt 上不动——
      // 恢复后 devin 进程从冻结点续跑，in-flight prompt 经日志补读自然完成。
      registerRunHandles(taskId, {
        acpAbort: (reason) => acp?.failAll(reason),
        pauseRun: async () => {
          acp?.beginPause();
          pauseDeadline();
          await e2bPause!();
          setRunStatus(taskId, "paused");
          phase(taskId, "agent", "已暂停（沙箱快照已保存，随时可恢复）");
        },
        resumeRun: async () => {
          phase(taskId, "agent", "恢复沙箱中…");
          await e2bResume!();
          await acp?.resume();
          resumeDeadline();
          setRunStatus(taskId, "running");
          phase(taskId, "agent", "已恢复，Agent 继续执行");
        },
      });
    }

    // ── Agent 执行 ──────────────────────────────────────────────
    phase(taskId, "agent", "Agent 执行中");
    emit(taskId, "runner", { type: "agent.started" });
    let lastText = "";

    if (acp) {
      // devin acp harness：ACP 事件已在桥内映射为规范化事件
      const resp = await acp.prompt(
        `工作目录是 GitHub 仓库 ${task.repo} 的任务分支 ${task.branch}（基于 ${task.baseBranch}）检出。\n\n` +
          `任务目标：${task.goal}\n\n` +
          `规则：不要执行 git commit/push/config 等变更远端或历史的命令（发布由系统统一处理）；` +
          `完成后用中文简要总结你做了什么、产出哪些文件、如何验证。`
      );
      lastText = acp.lastMessage;
      if (isCancelRequested(taskId)) {
        setRunStatus(taskId, "cancelled");
        return;
      }
      if (resp.stopReason === "cancelled" && !timedOut) {
        setRunStatus(taskId, "cancelled");
        return;
      }
      // timedOut 的 cancelled：继续往下走 verify/publish，尽量交付已有产出。
    } else {
    let modelFailed = false;
    const result = streamText({
      abortSignal: abortController.signal,
      model: resolveAgentModel(),
      system: SYSTEM_PROMPT,
      prompt:
        `仓库：${task.repo}，任务分支：${task.branch}，工作目录即仓库根目录。\n\n` +
        `任务目标：${task.goal}`,
      tools: createWorkspaceTools(driver, {
        onToolOutput: (toolCallId, chunk, stream) =>
          emit(taskId, "runner", {
            type: "tool.output.updated",
            toolCallId,
            mode: "append",
            output: stream === "stderr" ? `[stderr] ${chunk}` : chunk,
          }),
      }),
      stopWhen: isStepCount(MAX_STEPS),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      onError: ({ error }) => console.error("[agent-demo] 流内错误:", error),
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-start":
          emit(taskId, "runner", { type: "agent.message.started", messageId: part.id });
          break;
        case "text-delta":
          lastText += part.text;
          emit(taskId, "runner", {
            type: "agent.text.delta", messageId: part.id, blockId: part.id, text: part.text,
          });
          break;
        case "reasoning-start":
          emit(taskId, "runner", { type: "agent.message.started", messageId: `think-${part.id}` });
          break;
        case "reasoning-delta":
          emit(taskId, "runner", {
            type: "agent.thinking.delta", messageId: `think-${part.id}`, blockId: `think-${part.id}`, text: part.text,
          });
          break;
        case "tool-call":
          emit(taskId, "runner", {
            type: "tool.started", toolCallId: part.toolCallId, name: part.toolName, input: part.input as never,
          });
          break;
        case "tool-result":
          emit(taskId, "runner", {
            type: "tool.finished", toolCallId: part.toolCallId, isError: false, output: part.output as never,
          });
          break;
        case "tool-error":
          emit(taskId, "runner", {
            type: "tool.finished", toolCallId: part.toolCallId, isError: true, output: String(part.error),
          });
          break;
        case "error":
          modelFailed = true;
          emit(taskId, "runner", {
            type: "run.error",
            error: { code: "model_error", source: "runner", userMessage: String(part.error) },
          });
          break;
        default:
          break;
      }
    }
    if (isCancelRequested(taskId)) {
      setRunStatus(taskId, "cancelled");
      return;
    }
    if (modelFailed) {
      setRunStatus(taskId, "failed");
      return;
    }
    }

    // ── 核实：以 git status / diff 为证据，不信 Agent 自述 ────────
    phase(taskId, "verify", "核实产出");
    let changedFiles: string[];
    let diffDetail = "";
    if (driver.label !== "local") {
      const status = await driver.exec(["git", "status", "--porcelain", "-uall"]);
      changedFiles = status.stdout
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
      const diffStat = await driver.exec(["git", "diff", "HEAD", "--stat"]);
      diffDetail = diffStat.stdout.trim();
    } else {
      const after = await driver.listFiles();
      changedFiles = after.filter((f) => !filesBefore.has(f));
    }

    const verification: TaskResult["verification"] = [
      {
        label: "工作区存在变更",
        status: changedFiles.length > 0 ? "passed" : "failed",
        detail: `${changedFiles.length} 个文件`,
      },
    ];
    if (diffDetail) {
      verification.push({
        label: "git diff 证据",
        status: "passed",
        detail: diffDetail.split("\n").slice(-3).join("；"),
      });
    }

    if (isCancelRequested(taskId)) {
      setRunStatus(taskId, "cancelled");
      return;
    }

    // ── 受控发布：commit + push + Draft PR ──────────────────────
    let commitSha: string | null = null;
    let pullRequest: TaskResult["pullRequest"] = null;
    const canPublish = remoteReady && changedFiles.length > 0;
    if (canPublish) {
      phase(taskId, "publish", "提交并发布");
      const commit = await driver.exec(
        `git add -A && git commit -m 'agent: ${task.title.replace(/'/g, "")}' && git rev-parse HEAD`
      );
      if (commit.exitCode !== 0) {
        fail(taskId, "commit_failed", "runner", `提交失败: ${commit.stderr || commit.stdout}`);
        return;
      }
      commitSha = commit.stdout.trim().split("\n").pop() ?? null;
      verification.push({ label: "变更已提交到任务分支", status: "passed", detail: commitSha?.slice(0, 8) ?? "" });

      const push = await driver.exec(`git push -u origin ${task.branch}`, 120_000);
      if (push.exitCode !== 0) {
        fail(taskId, "push_failed", "runner", `推送失败: ${push.stderr || push.stdout}`);
        return;
      }

      pullRequest = await publishDraftPr({
        repo: task.repo,
        token: githubToken!,
        head: task.branch,
        base: task.baseBranch,
        title: `[agent] ${task.title}`,
        body: `由 ThreadChat Agent 任务 ${task.id} 生成。\n\n目标：${task.goal}\n\n— Draft PR，请人工审阅后再合入。`,
        expectedHeadSha: commitSha ?? "",
      });
      verification.push({ label: "Draft PR 已创建", status: "passed", detail: pullRequest.url });
    } else if (!remoteReady) {
      verification.push({ label: "发布", status: "not_run", detail: "未配置沙箱/GITHUB_TOKEN，跳过推送" });
    } else {
      verification.push({ label: "发布", status: "not_run", detail: "无变更，跳过推送" });
    }

    const delivered = verification.every((v) => v.status !== "failed") && changedFiles.length > 0;
    if (timedOut) {
      verification.push({
        label: "运行时长",
        status: "failed",
        detail: `超过 ${TASK_TIME_BUDGET_MS / 60000} 分钟预算，Agent 被中止`,
      });
    }
    const taskResult: TaskResult = {
      // 超时收尾：即使 PR 已开出也只算 partial（工作不完整）
      outcome: delivered && !timedOut ? "delivered" : "partial",
      summary: (timedOut ? "⚠️ 任务超时中止，以下为中止前的产出。\n\n" : "") +
        (lastText.slice(-2000) || "(Agent 未输出总结)"),
      changedFiles,
      verification,
      commitSha,
      pullRequest,
    };
    emit(taskId, "runner", { type: "run.result.saved", result: taskResult });
    // 超时但产出了 PR → completed/partial；超时且无产出 → failed
    setRunStatus(taskId, delivered || (timedOut && pullRequest) ? "completed" : "failed");
  } catch (error) {
    if (timedOut) {
      fail(taskId, "task_timeout", "runner", `任务超过 ${TASK_TIME_BUDGET_MS / 60000} 分钟预算后出错: ${error instanceof Error ? error.message : String(error)}`);
    } else if (isCancelRequested(taskId) || abortController.signal.aborted) {
      setRunStatus(taskId, "cancelled");
    } else {
      fail(taskId, "run_failed", "runner", error instanceof Error ? error.message : String(error));
    }
  } finally {
    clearTimeout(deadline);
    if (release) {
      phase(taskId, "release", "回收执行环境");
      await release().catch(() => {});
    }
  }
}
