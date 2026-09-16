// 执行环境：优先真实 e2b 沙箱，其次 boxd VM，最后本地目录回退。
// 提供统一的 WorkspaceDriver 接口给工具集绑定。

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { Boxd, type Machine } from "@boxd-sh/sdk";
import { CommandExitError, Sandbox } from "e2b";

const execFileAsync = promisify(execFile);

export type ExecOut = { exitCode: number; stdout: string; stderr: string };

/** 命令输出的流式回调：stdout/stderr 逐块到达。 */
export type OutputHandler = (chunk: string, stream: "stdout" | "stderr") => void;

/** Agent 工具与 Worker 步骤共用的工作区操作面。 */
export interface WorkspaceDriver {
  readonly workdir: string;
  readonly label: string;
  listFiles(dir?: string): Promise<string[]>;
  readFile(relPath: string): Promise<string>;
  writeFile(relPath: string, content: string): Promise<void>;
  exec(command: string | string[], timeoutMs?: number, onOutput?: OutputHandler): Promise<ExecOut>;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// boxd 实现

export class BoxdDriver implements WorkspaceDriver {
  readonly label = "boxd";
  constructor(
    private readonly boxd: Boxd,
    private readonly machineId: string,
    readonly workdir: string
  ) {}

  async exec(command: string | string[], timeoutMs = 60_000): Promise<ExecOut> {
    const cmd = Array.isArray(command)
      ? command.map(shQuote).join(" ")
      : command;
    const result = await this.boxd.machines.exec(this.machineId, {
      command: `cd ${shQuote(this.workdir)} && ${cmd}`,
      timeout: timeoutMs,
    });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  }

  /** 不受工作区 cd 限制的原始 exec（clone 前工作目录还不存在时用）。 */
  async execRaw(command: string, timeoutMs = 60_000): Promise<ExecOut> {
    const result = await this.boxd.machines.exec(this.machineId, {
      command,
      timeout: timeoutMs,
    });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  }

  async listFiles(dir = "."): Promise<string[]> {
    const { stdout, exitCode, stderr } = await this.exec(
      `find ${shQuote(dir)} -type f -not -path '*/.git/*' | sort`
    );
    if (exitCode !== 0) throw new Error(`listFiles 失败: ${stderr || stdout}`);
    return stdout
      .split("\n")
      .map((line) => line.trim().replace(/^\.\//, ""))
      .filter(Boolean);
  }

  async readFile(relPath: string): Promise<string> {
    const data = await this.boxd.machines.files.download(
      this.machineId,
      `${this.workdir}/${relPath}`
    );
    return new TextDecoder().decode(data);
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const abs = `${this.workdir}/${relPath}`;
    const dir = path.posix.dirname(abs);
    await this.execRaw(`mkdir -p ${shQuote(dir)}`);
    await this.boxd.machines.files.upload(this.machineId, abs, content);
  }
}

export type BoxdEnvironment = {
  machine: Machine;
  driver: BoxdDriver;
  release: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// e2b 实现

export class E2bDriver implements WorkspaceDriver {
  readonly label = "e2b";
  constructor(
    private readonly sandbox: Sandbox,
    readonly workdir: string
  ) {}

  async exec(command: string | string[], timeoutMs = 60_000, onOutput?: OutputHandler): Promise<ExecOut> {
    const cmd = Array.isArray(command)
      ? command.map(shQuote).join(" ")
      : command;
    const result = await this.sandbox.commands.run(cmd, {
      cwd: this.workdir,
      timeoutMs,
      ...(onOutput
        ? {
            onStdout: (data: string) => onOutput(data, "stdout"),
            onStderr: (data: string) => onOutput(data, "stderr"),
          }
        : {}),
    });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  }

  async execRaw(command: string, timeoutMs = 60_000): Promise<ExecOut> {
    const result = await this.sandbox.commands.run(command, { timeoutMs });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  }

  async listFiles(dir = "."): Promise<string[]> {
    const { stdout, exitCode, stderr } = await this.exec(
      `find ${shQuote(dir)} -type f -not -path '*/.git/*' -not -path '*/node_modules/*' | sort`
    );
    if (exitCode !== 0) throw new Error(`listFiles 失败: ${stderr || stdout}`);
    return stdout
      .split("\n")
      .map((line) => line.trim().replace(/^\.\//, ""))
      .filter(Boolean);
  }

  async readFile(relPath: string): Promise<string> {
    return this.sandbox.files.read(`${this.workdir}/${relPath}`);
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const abs = `${this.workdir}/${relPath}`;
    const dir = path.posix.dirname(abs);
    await this.execRaw(`mkdir -p ${shQuote(dir)}`);
    await this.sandbox.files.write(abs, content);
  }
}

export type E2bEnvironment = {
  sandboxId: string;
  sandbox: Sandbox;
  driver: E2bDriver;
  release: () => Promise<void>;
};

const DEVIN_BIN = "/home/user/.local/bin/devin";
const DEVIN_CRED_PATH = "/home/user/.local/share/devin/credentials.toml";

/**
 * 在 e2b 沙箱内安装 devin CLI 并写入凭据，返回 devin 可执行文件路径。
 * credentialsToml 为本机 ~/.local/share/devin/credentials.toml 的内容（密钥材料，
 * 只进沙箱文件系统，不进事件表）。
 */
async function runChecked(sandbox: Sandbox, cmd: string, timeoutMs: number, what: string) {
  try {
    return await sandbox.commands.run(cmd, { timeoutMs });
  } catch (error) {
    const e = error as CommandExitError;
    throw new Error(`${what}: ${e.stderr || e.stdout || e.message}`);
  }
}

export async function installDevinHarness(
  sandbox: Sandbox,
  credentialsToml: string
): Promise<string> {
  // 走自定义模板（E2B_TEMPLATE）时 devin 已烤进镜像，跳过下载安装。
  // install.sh 末尾会跑交互式 `devin setup`，非交互环境必然报 "Login canceled"，
  // 但二进制本身已装好——因此忽略安装脚本退出码，用 `devin version` 验证。
  if (!process.env.E2B_TEMPLATE?.trim()) {
    await sandbox.commands.run(
      `curl -fsSL https://cli.devin.ai/install.sh | bash || true`,
      { timeoutMs: 300_000 }
    ).catch(() => {});
  }
  await runChecked(
    sandbox,
    `mkdir -p ${shQuote(path.posix.dirname(DEVIN_CRED_PATH))}`,
    10_000,
    "创建凭据目录失败"
  );
  await sandbox.files.write(DEVIN_CRED_PATH, credentialsToml);
  const check = await runChecked(sandbox, `${DEVIN_BIN} version`, 30_000, "devin CLI 不可用");
  if (!check.stdout.trim()) throw new Error("devin CLI 无输出");
  return DEVIN_BIN;
}

const E2B_WORKDIR = "/home/user/repo";
// Hobby 层单会话上限 1 小时；demo 任务给 30 分钟足够。
const E2B_SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;

export async function createE2bEnvironment(input: {
  taskId: string;
  repo: string;
  branch: string;
  baseBranch: string;
  githubToken: string;
  onPhase?: (label: string) => void;
}): Promise<E2bEnvironment> {
  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) throw new Error("E2B_API_KEY 未配置");

  // E2B_TEMPLATE 指向自定义模板（devin CLI 已烤入镜像）；缺省用官方 base，
  // devin 在任务内现装（慢 ~12s，但无需预先构建模板）。
  const template = process.env.E2B_TEMPLATE?.trim() || "base";
  input.onPhase?.(template === "base" ? "创建 e2b 沙箱" : `创建 e2b 沙箱（模板 ${template}）`);
  const sandbox = await Sandbox.create(template, { apiKey, timeoutMs: E2B_SANDBOX_TIMEOUT_MS });
  const driver = new E2bDriver(sandbox, E2B_WORKDIR);

  input.onPhase?.("检出仓库");
  const clone = await driver.execRaw(
    `git clone ${shQuote(`https://x-access-token:${input.githubToken}@github.com/${input.repo}.git`)} ${shQuote(E2B_WORKDIR)}`,
    300_000
  );
  if (clone.exitCode !== 0) {
    await sandbox.kill().catch(() => {});
    throw new Error(`git clone 失败: ${clone.stderr || clone.stdout}`);
  }

  const setup = await driver.exec(
    `git checkout -b ${shQuote(input.branch)} ${shQuote(`origin/${input.baseBranch}`)} && ` +
      `git config user.email 'agent@thread-chat.demo' && git config user.name 'ThreadChat Agent'`
  );
  if (setup.exitCode !== 0) {
    await sandbox.kill().catch(() => {});
    throw new Error(`任务分支创建失败: ${setup.stderr || setup.stdout}`);
  }

  return {
    sandboxId: sandbox.sandboxId,
    sandbox,
    driver,
    release: async () => {
      await sandbox.kill().catch(() => {});
    },
  };
}

const BOX_WORKDIR = "/home/boxd/repo";

export async function createBoxdEnvironment(input: {
  taskId: string;
  repo: string; // owner/name
  branch: string;
  baseBranch: string;
  githubToken: string;
  onPhase?: (label: string) => void;
}): Promise<BoxdEnvironment> {
  const apiKey = process.env.BOXD_API_KEY?.trim();
  if (!apiKey) throw new Error("BOXD_API_KEY 未配置");

  const boxd = new Boxd({ apiKey });
  const name = `tc-${input.taskId}`;

  input.onPhase?.(`创建 boxd 机器 ${name}`);
  const machine = await boxd.machines.create({ name });
  await boxd.machines.waitUntilReady(machine.id, { timeout: 180_000 });

  const driver = new BoxdDriver(boxd, machine.id, BOX_WORKDIR);

  input.onPhase?.("检出仓库");
  const clone = await driver.execRaw(
    `git clone ${shQuote(`https://x-access-token:${input.githubToken}@github.com/${input.repo}.git`)} ${shQuote(BOX_WORKDIR)}`,
    300_000
  );
  if (clone.exitCode !== 0) {
    await boxd.machines.delete(machine.id).catch(() => {});
    throw new Error(`git clone 失败: ${clone.stderr || clone.stdout}`);
  }

  const setup = await driver.exec(
    `git checkout -b ${shQuote(input.branch)} ${shQuote(`origin/${input.baseBranch}`)} && ` +
      `git config user.email 'agent@thread-chat.demo' && git config user.name 'ThreadChat Agent'`
  );
  if (setup.exitCode !== 0) {
    await boxd.machines.delete(machine.id).catch(() => {});
    throw new Error(`任务分支创建失败: ${setup.stderr || setup.stdout}`);
  }

  return {
    machine,
    driver,
    release: async () => {
      await boxd.machines.delete(machine.id).catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------
// 本地回退实现（无 BOXD_API_KEY 时的旧 demo 路径）

export class LocalDriver implements WorkspaceDriver {
  readonly label = "local";
  constructor(readonly workdir: string) {}

  private resolve(relPath: string): string {
    const resolved = path.resolve(this.workdir, relPath);
    if (resolved !== this.workdir && !resolved.startsWith(this.workdir + path.sep)) {
      throw new Error(`路径越界：${relPath}`);
    }
    return resolved;
  }

  async listFiles(dir = "."): Promise<string[]> {
    const base = this.resolve(dir);
    const out: string[] = [];
    const walk = async (d: string, prefix: string) => {
      for (const entry of await readdir(d, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(d, entry.name), rel);
        else out.push(rel);
      }
    };
    await walk(base, dir === "." ? "" : dir);
    return out.sort();
  }

  async readFile(relPath: string): Promise<string> {
    return readFile(this.resolve(relPath), "utf8");
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const resolved = this.resolve(relPath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, content);
  }

  async exec(command: string | string[], timeoutMs = 60_000): Promise<ExecOut> {
    const argv = Array.isArray(command) ? command : [command];
    try {
      const { stdout, stderr } = await execFileAsync(argv[0], argv.slice(1), {
        cwd: this.workdir,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        exitCode: typeof e.code === "number" ? e.code : -1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? e.message ?? "命令执行失败",
      };
    }
  }
}
