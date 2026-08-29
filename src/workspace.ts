import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

export interface WorkspaceSnapshot {
  root: string;
  workspace: string;
  isGit: boolean;
  branch: string | null;
  commit: string | null;
  remoteUrl: string | null;
  changedFiles: string[];
}

function git(cwd: string, args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2_000,
  });
  return { ok: result.status === 0, stdout: (result.stdout ?? "").replace(/\r?\n$/, "") };
}

function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/^"|"$/g, "").replace(/\\/g, "/").replace(/^\.\//, "");
  const renamed = trimmed.includes(" -> ") ? trimmed.split(" -> ").at(-1)! : trimmed;
  return renamed.trim();
}

function uniquePaths(paths: Iterable<string>): string[] {
  return [...new Set([...paths].map(normalizePath).filter(Boolean))].sort().slice(0, 500);
}

export function workingTreeFiles(root: string): string[] {
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (!status.ok || !status.stdout) return [];
  return uniquePaths(status.stdout.split("\n").map((line) => line.slice(3)));
}

export function detectWorkspace(cwd: string): WorkspaceSnapshot {
  const absoluteCwd = resolve(cwd);
  const topLevel = git(absoluteCwd, ["rev-parse", "--show-toplevel"]);
  if (!topLevel.ok || !topLevel.stdout) {
    return {
      root: absoluteCwd,
      workspace: absoluteCwd,
      isGit: false,
      branch: null,
      commit: null,
      remoteUrl: null,
      changedFiles: [],
    };
  }

  const root = resolve(topLevel.stdout);
  const branch = git(root, ["branch", "--show-current"]);
  const commit = git(root, ["rev-parse", "HEAD"]);
  const remote = git(root, ["config", "--get", "remote.origin.url"]);
  return {
    root,
    workspace: root.replace(/\\/g, "/").replace(/\/$/, ""),
    isGit: true,
    branch: branch.ok && branch.stdout ? branch.stdout : null,
    commit: commit.ok && commit.stdout ? commit.stdout : null,
    remoteUrl: remote.ok && remote.stdout ? remote.stdout : null,
    changedFiles: workingTreeFiles(root),
  };
}

export function commitExists(root: string, commit: string): boolean {
  return git(root, ["cat-file", "-e", `${commit}^{commit}`]).ok;
}

export function isAncestor(root: string, commit: string): boolean {
  return git(root, ["merge-base", "--is-ancestor", commit, "HEAD"]).ok;
}

export function filesChangedSince(root: string, commit: string): string[] {
  const committed = git(root, ["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${commit}..HEAD`]);
  return uniquePaths([...(committed.ok && committed.stdout ? committed.stdout.split("\n") : []), ...workingTreeFiles(root)]);
}

export function sessionChangedFiles(snapshot: WorkspaceSnapshot, startCommit: string | null): string[] {
  if (!snapshot.isGit || !startCommit || !commitExists(snapshot.root, startCommit) || !isAncestor(snapshot.root, startCommit)) {
    return snapshot.changedFiles;
  }
  return filesChangedSince(snapshot.root, startCommit);
}

export function fingerprintFiles(root: string, paths: string[]): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  const absoluteRoot = resolve(root);
  for (const relativePath of uniquePaths(paths)) {
    try {
      const absolutePath = resolve(absoluteRoot, relativePath);
      if (!absolutePath.startsWith(`${absoluteRoot}${sep}`)) continue;
      const stat = statSync(absolutePath);
      result[relativePath] = stat.isFile()
        ? stat.size <= 5_000_000
          ? createHash("sha256").update(readFileSync(absolutePath)).digest("hex")
          : `large:${stat.size}:${Math.round(stat.mtimeMs)}`
        : null;
    } catch {
      result[relativePath] = null;
    }
  }
  return result;
}
