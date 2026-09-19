// 本地沙箱工作区，代替方案中的 boxd 环境：每个任务一个独立目录，
// 预置一份 spec，Agent 只能在该目录内读写和执行白名单命令。

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const WORKSPACE_ROOT = path.join(process.cwd(), ".agent-demo-workspaces");

const SEED_SPEC = `# 需求规格：任务清单 CLI

## 背景
我们需要一个最小任务清单命令行工具的规格说明实现，用于演示 Agent 编码流程。

## 功能要求
1. 支持添加任务：每条任务包含 id、标题、完成状态。
2. 支持列出全部任务，按 id 排序输出。
3. 支持将任务标记为完成。
4. 数据保存在同目录的 todos.json 中，程序重启后不丢失。

## 验收标准
- 设计文档需覆盖数据模型、命令格式与错误处理。
- 不引入第三方依赖。
`;

const SEED_README = `# demo-workspace

本目录是 Agent 的沙箱工作区（模拟 boxd 中的仓库 checkout）。

- spec.md：本次任务的需求规格
- docs/：设计文档输出目录
`;

export async function prepareWorkspace(taskId: string): Promise<string> {
  const dir = path.join(WORKSPACE_ROOT, taskId);
  await mkdir(path.join(dir, "docs"), { recursive: true });
  await writeFile(path.join(dir, "spec.md"), SEED_SPEC);
  await writeFile(path.join(dir, "README.md"), SEED_README);
  return dir;
}

/** 把相对路径限制在工作区内，拒绝越界访问。 */
export function resolveInWorkspace(workspace: string, relPath: string): string {
  const resolved = path.resolve(workspace, relPath);
  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    throw new Error(`路径越界：${relPath}`);
  }
  return resolved;
}

export async function listFiles(workspace: string, relDir = "."): Promise<string[]> {
  const base = resolveInWorkspace(workspace, relDir);
  const out: string[] = [];
  async function walk(dir: string, prefix: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  }
  await walk(base, relDir === "." ? "" : relDir);
  return out.sort();
}

export async function readWorkspaceFile(workspace: string, relPath: string) {
  return readFile(resolveInWorkspace(workspace, relPath), "utf8");
}

export async function writeWorkspaceFile(
  workspace: string,
  relPath: string,
  content: string
) {
  const resolved = resolveInWorkspace(workspace, relPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content);
  return resolved;
}

/** 返回工作区内相对路径有变化的文件（与种子文件集合对比）。 */
export async function diffWorkspaceFiles(
  workspace: string,
  seedFiles: Set<string>
): Promise<string[]> {
  const current = await listFiles(workspace);
  const changed: string[] = [];
  for (const rel of current) {
    if (!seedFiles.has(rel)) {
      changed.push(rel);
      continue;
    }
    // 种子文件也可能被改写，暂按“新增即变更”处理，demo 足够
  }
  return changed;
}

export async function fileExists(workspace: string, relPath: string) {
  try {
    await stat(resolveInWorkspace(workspace, relPath));
    return true;
  } catch {
    return false;
  }
}
