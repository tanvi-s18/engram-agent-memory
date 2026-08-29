import { MemoryStore } from "./store.js";
import { refreshInvalidations } from "./invalidation.js";
import { MEMORY_KINDS, type MemoryKind, type ProposalStatus } from "./types.js";
import { detectWorkspace } from "./workspace.js";

const args = process.argv.slice(2);
const command = args.shift();

function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function numberOption(name: string): number | undefined {
  const value = option(name);
  return value ? Number.parseInt(value, 10) : undefined;
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function currentWorkspace() {
  return detectWorkspace(option("cwd") ?? process.cwd());
}

function help() {
  process.stdout.write(`Engram agent memory\n\n`);
  process.stdout.write(`  detect    [--cwd <path>]\n`);
  process.stdout.write(`  recall    [--workspace <id>] [--query <task>] [--branch <name>] [--limit <n>]\n`);
  process.stdout.write(`  remember  [--workspace <id>] --kind <kind> --content <text> [--agent <name>]\n`);
  process.stdout.write(`  handoff   [--workspace <id>] --content <summary> [--agent <name>]\n`);
  process.stdout.write(`  list      [--workspace <id>] [--limit <n>]\n`);
  process.stdout.write(`  proposals [--status pending|approved|rejected] [--workspace <id>]\n`);
  process.stdout.write(`  approve   --id <uuid>\n`);
  process.stdout.write(`  reject    --id <uuid>\n`);
  process.stdout.write(`  refresh   [--cwd <path>]\n`);
  process.stdout.write(`  forget    --id <uuid>\n\n`);
  process.stdout.write(`Kinds: ${MEMORY_KINDS.join(", ")}\n`);
}

const store = new MemoryStore();
try {
  const snapshot = currentWorkspace();
  switch (command) {
    case "detect":
      print(snapshot);
      break;
    case "recall":
      refreshInvalidations(store, snapshot);
      print(
        store.recall({
          workspace: option("workspace") ?? snapshot.workspace,
          query: option("query"),
          branch: option("branch") ?? snapshot.branch ?? undefined,
          limit: numberOption("limit"),
        }),
      );
      break;
    case "remember": {
      const kind = required("kind");
      if (!MEMORY_KINDS.includes(kind as MemoryKind)) throw new Error(`Unknown memory kind: ${kind}`);
      print(
        store.remember({
          workspace: option("workspace") ?? snapshot.workspace,
          kind: kind as MemoryKind,
          content: required("content"),
          sourceAgent: option("agent") ?? "cli",
          branch: option("branch") ?? snapshot.branch ?? undefined,
          sourceCommit: snapshot.commit ?? undefined,
        }),
      );
      break;
    }
    case "handoff":
      print(
        store.remember({
          workspace: option("workspace") ?? snapshot.workspace,
          kind: "handoff",
          content: required("content"),
          sourceAgent: option("agent") ?? "cli",
          branch: option("branch") ?? snapshot.branch ?? undefined,
          sourceCommit: snapshot.commit ?? undefined,
          confidence: 0.85,
        }),
      );
      break;
    case "list":
      print(store.list(option("workspace"), numberOption("limit") ?? 100));
      break;
    case "proposals": {
      const status = option("status") as ProposalStatus | undefined;
      if (status && !["pending", "approved", "rejected"].includes(status)) throw new Error(`Unknown proposal status: ${status}`);
      print(store.proposals(status, option("workspace"), numberOption("limit") ?? 100));
      break;
    }
    case "approve":
      print(store.reviewProposal(required("id"), "approved"));
      break;
    case "reject":
      print(store.reviewProposal(required("id"), "rejected"));
      break;
    case "refresh":
      print({ workspace: snapshot, ...refreshInvalidations(store, snapshot) });
      break;
    case "forget":
      print({ id: required("id"), deleted: store.forget(required("id")) });
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      help();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exitCode = 1;
} finally {
  store.close();
}
