// Agent 工具集：作用域限定在 WorkspaceDriver 内，对应方案中的 allowedActions 控制。
// demo 只开放 read/edit/test 级能力；commit/push/PR 是受控发布步骤，不作为工具暴露。

import { tool } from "ai";
import { z } from "zod";
import type { OutputHandler, WorkspaceDriver } from "@/lib/agent-demo/environment";

// run_command 的可执行文件白名单：只读/定位/构建测试类命令。
const ALLOWED_COMMANDS = new Set([
  "ls", "cat", "grep", "find", "wc", "echo", "pwd", "head", "tail", "sed", "sort", "diff",
  "node", "npm", "npx", "pnpm", "git",
]);
// git 只允许只读子命令，写操作（add/commit/push）由 Worker 受控执行。
const ALLOWED_GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show", "ls-files", "branch"]);
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 8_000;

function truncate(text: string) {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(输出已截断，共 ${text.length} 字符)`
    : text;
}

export function createWorkspaceTools(
  driver: WorkspaceDriver,
  opts?: { onToolOutput?: (toolCallId: string, chunk: string, stream: "stdout" | "stderr") => void }
) {
  return {
    list_files: tool({
      description: "列出工作区内的文件（递归，排除 .git 与 node_modules）。",
      inputSchema: z.object({
        directory: z.string().default(".").describe("相对工作区根目录的路径"),
      }),
      execute: async ({ directory }) => {
        try {
          let files = await driver.listFiles(directory);
          if (driver.label === "boxd") {
            files = files.filter((f) => !f.includes("node_modules/") && !f.includes(".git/"));
          }
          return { files: files.slice(0, 500) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
    read_file: tool({
      description: "读取工作区内某个文件的全部内容。",
      inputSchema: z.object({
        path: z.string().describe("相对工作区根目录的文件路径"),
      }),
      execute: async ({ path: relPath }) => {
        try {
          return { path: relPath, content: truncate(await driver.readFile(relPath)) };
        } catch {
          return { path: relPath, error: "文件不存在或不可读" };
        }
      },
    }),
    write_file: tool({
      description: "在工作区内创建或覆盖一个文件，目录不存在时自动创建。",
      inputSchema: z.object({
        path: z.string().describe("相对工作区根目录的文件路径"),
        content: z.string().describe("文件完整内容"),
      }),
      execute: async ({ path: relPath, content }) => {
        if (relPath.includes("..")) {
          return { path: relPath, error: "路径不允许包含 .." };
        }
        try {
          await driver.writeFile(relPath, content);
          return { path: relPath, bytes: Buffer.byteLength(content), written: true };
        } catch (error) {
          return { path: relPath, error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
    run_command: tool({
      description:
        `在工作区内执行命令。允许的程序：${[...ALLOWED_COMMANDS].join(", ")}；` +
        `git 只允许只读子命令：${[...ALLOWED_GIT_SUBCOMMANDS].join(", ")}。` +
        "不接受管道、重定向或链接多个命令。",
      inputSchema: z.object({
        command: z.string().describe("程序名，必须是白名单内命令"),
        args: z.array(z.string()).default([]).describe("参数列表"),
      }),
      execute: async ({ command, args }, execOptions) => {
        if (!ALLOWED_COMMANDS.has(command)) {
          return { error: `命令不在白名单内：${command}` };
        }
        if (command === "git" && !ALLOWED_GIT_SUBCOMMANDS.has(args[0] ?? "")) {
          return { error: `git 子命令不允许：${args[0] ?? "(空)"}` };
        }
        if (args.some((a) => a.includes("..") && !a.startsWith("-"))) {
          return { error: "参数不允许包含 .." };
        }
        const toolCallId = (execOptions as { toolCallId?: string }).toolCallId;
        const onOutput: OutputHandler | undefined =
          opts?.onToolOutput && toolCallId
            ? (chunk, stream) => opts.onToolOutput!(toolCallId, chunk, stream)
            : undefined;
        const result = await driver.exec([command, ...args], COMMAND_TIMEOUT_MS, onOutput);
        return {
          exitCode: result.exitCode,
          stdout: truncate(result.stdout),
          stderr: truncate(result.stderr),
        };
      },
    }),
  };
}

export type WorkspaceTools = ReturnType<typeof createWorkspaceTools>;
