import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { MemoryStore } from "../src/store.js";
import { refreshInvalidations } from "../src/invalidation.js";
import { detectWorkspace, fingerprintFiles } from "../src/workspace.js";

let directory: string;
let store: MemoryStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "engram-test-"));
  store = new MemoryStore(join(directory, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

test("stores, deduplicates, and recalls repository memories", () => {
  const first = store.remember({
    workspace: "/projects/food-app/",
    branch: "main",
    kind: "decision",
    content: "Use SQLite for local-first persistence.",
    sourceAgent: "codex",
    confidence: 0.95,
  });
  const duplicate = store.remember({
    workspace: "/projects/food-app",
    kind: "decision",
    content: "Use SQLite for local-first persistence.",
  });

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.memory.id, first.memory.id);
  assert.equal(store.recall({ workspace: "/projects/food-app", query: "SQLite persistence" }).length, 1);
});

test("supersedes an obsolete memory and keeps provenance", () => {
  const original = store.remember({
    workspace: "repo-a",
    kind: "constraint",
    content: "Support Node 20.",
  }).memory;
  const replacement = store.supersede(original.id, {
    kind: "constraint",
    content: "Support Node 22 and newer.",
    sourceAgent: "claude",
  });

  assert.equal(store.get(original.id)?.status, "superseded");
  assert.equal(replacement.supersedesId, original.id);
  assert.deepEqual(store.recall({ workspace: "repo-a" }).map((memory) => memory.id), [replacement.id]);
});

test("permanently forgets a memory", () => {
  const memory = store.remember({ workspace: "repo-a", kind: "observation", content: "Temporary note." }).memory;
  assert.equal(store.forget(memory.id), true);
  assert.equal(store.get(memory.id), null);
  assert.equal(store.forget(memory.id), false);
});

test("rejects likely secrets", () => {
  assert.throws(
    () =>
      store.remember({
        workspace: "repo-a",
        kind: "observation",
        content: "api_key=abcdefghijklmnopqrstuvwxyz123456",
      }),
    /appears to contain/i,
  );
});

test("keeps generated handoffs pending until they are approved", () => {
  const first = store.propose({
    workspace: "repo-a",
    branch: "main",
    kind: "handoff",
    content: "Implemented the schema. Tests still need to be added.",
    sourceAgent: "codex",
    sourceSession: "session-1",
    signature: "signature-1",
  });
  const updated = store.propose({
    workspace: "repo-a",
    branch: "main",
    kind: "handoff",
    content: "Implemented the schema and added all tests.",
    sourceAgent: "codex",
    sourceSession: "session-1",
    signature: "signature-2",
  });

  assert.equal(first.created, true);
  assert.equal(updated.created, false);
  assert.equal(updated.proposal.id, first.proposal.id);
  assert.equal(store.recall({ workspace: "repo-a" }).length, 0);

  const approved = store.reviewProposal(first.proposal.id, "approved");
  assert.equal(approved.status, "approved");
  assert.ok(approved.approvedMemoryId);
  assert.equal(store.recall({ workspace: "repo-a" }).length, 1);
});

test("quarantines a Git-linked memory after its source file changes", () => {
  const repository = join(directory, "repository");
  execFileSync("git", ["init", repository], { stdio: "ignore" });
  execFileSync("git", ["-C", repository, "config", "user.email", "engram@example.test"]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Engram Test"]);
  writeFileSync(join(repository, "architecture.md"), "Use SQLite.\n");
  execFileSync("git", ["-C", repository, "add", "architecture.md"]);
  execFileSync("git", ["-C", repository, "commit", "-m", "initial"], { stdio: "ignore" });
  const initial = detectWorkspace(repository);
  const memory = store.remember({
    workspace: initial.workspace,
    kind: "decision",
    content: "The architecture document selects SQLite.",
    sourceCommit: initial.commit!,
    filePaths: ["architecture.md"],
  }).memory;

  writeFileSync(join(repository, "architecture.md"), "Use PostgreSQL.\n");
  const result = refreshInvalidations(store, detectWorkspace(repository));

  assert.equal(result.invalidated, 1);
  assert.ok(store.get(memory.id)?.invalidatedAt);
  assert.equal(store.recall({ workspace: initial.workspace }).length, 0);
});

test("uses file fingerprints so approved dirty work is not immediately stale", () => {
  const repository = join(directory, "dirty-repository");
  execFileSync("git", ["init", repository], { stdio: "ignore" });
  execFileSync("git", ["-C", repository, "config", "user.email", "engram@example.test"]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Engram Test"]);
  writeFileSync(join(repository, "plan.md"), "Version one.\n");
  execFileSync("git", ["-C", repository, "add", "plan.md"]);
  execFileSync("git", ["-C", repository, "commit", "-m", "initial"], { stdio: "ignore" });
  writeFileSync(join(repository, "plan.md"), "Version two, not committed.\n");
  const snapshot = detectWorkspace(repository);
  const memory = store.remember({
    workspace: snapshot.workspace,
    kind: "handoff",
    content: "The working tree contains version two of the plan.",
    sourceCommit: snapshot.commit!,
    filePaths: ["plan.md"],
    fileFingerprints: fingerprintFiles(repository, ["plan.md"]),
  }).memory;

  assert.equal(refreshInvalidations(store, detectWorkspace(repository)).invalidated, 0);
  assert.equal(store.get(memory.id)?.invalidatedAt, null);

  writeFileSync(join(repository, "plan.md"), "Version three.\n");
  assert.equal(refreshInvalidations(store, detectWorkspace(repository)).invalidated, 1);
  assert.ok(store.get(memory.id)?.invalidatedAt);
});
