import type { MemoryStore } from "./store.js";
import { commitExists, filesChangedSince, fingerprintFiles, isAncestor, type WorkspaceSnapshot } from "./workspace.js";

export interface InvalidationResult {
  checked: number;
  invalidated: number;
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function refreshInvalidations(store: MemoryStore, snapshot: WorkspaceSnapshot): InvalidationResult {
  if (!snapshot.isGit) return { checked: 0, invalidated: 0 };
  const memories = store.validatable(snapshot.workspace);
  const changesByCommit = new Map<string, Set<string> | null>();
  let invalidated = 0;

  for (const memory of memories) {
    const fingerprintPaths = Object.keys(memory.fileFingerprints);
    if (fingerprintPaths.length > 0) {
      const current = fingerprintFiles(snapshot.root, fingerprintPaths);
      const affected = fingerprintPaths.filter((path) => current[path] !== memory.fileFingerprints[path]);
      if (affected.length > 0) {
        if (store.invalidate(memory.id, `Files changed after this memory was captured: ${affected.slice(0, 8).join(", ")}`)) {
          invalidated++;
        }
      }
      continue;
    }

    const commit = memory.sourceCommit;
    if (!commit) continue;
    if (!changesByCommit.has(commit)) {
      if (!commitExists(snapshot.root, commit) || !isAncestor(snapshot.root, commit)) {
        changesByCommit.set(commit, null);
      } else {
        changesByCommit.set(commit, new Set(filesChangedSince(snapshot.root, commit).map(normalize)));
      }
    }

    const changed = changesByCommit.get(commit);
    if (changed === undefined) continue;
    if (changed === null) {
      if (store.invalidate(memory.id, `Source commit ${commit.slice(0, 12)} is no longer in the current Git history.`)) invalidated++;
      continue;
    }
    const affected = memory.filePaths.map(normalize).filter((path) => changed.has(path));
    if (affected.length > 0) {
      if (store.invalidate(memory.id, `Referenced files changed after ${commit.slice(0, 12)}: ${affected.slice(0, 8).join(", ")}`)) {
        invalidated++;
      }
    }
  }

  return { checked: memories.length, invalidated };
}
