import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

interface HookHandler {
  type: "command";
  command: string;
  timeout: number;
  statusMessage?: string;
  additionalContextLimit?: number;
}

interface HookGroup {
  matcher?: string;
  hooks: HookHandler[];
}

const marker = "dist/src/hook.js";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function readJson(path: string): JsonObject {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isEngramGroup(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const hooks = (value as { hooks?: unknown }).hooks;
  return Array.isArray(hooks) && hooks.some((hook) => {
    if (!hook || typeof hook !== "object") return false;
    return String((hook as { command?: unknown }).command ?? "").includes(marker);
  });
}

function mergeEvent(config: JsonObject, event: string, group: HookGroup | null): void {
  const hooks = config.hooks && typeof config.hooks === "object" && !Array.isArray(config.hooks) ? (config.hooks as JsonObject) : {};
  const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]).filter((entry) => !isEngramGroup(entry)) : [];
  if (group) existing.push(group);
  if (existing.length > 0) hooks[event] = existing;
  else delete hooks[event];
  config.hooks = hooks;
}

function writeConfig(path: string, config: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function install(target: "codex" | "claude", remove: boolean): string {
  const path =
    target === "codex" ? resolve(homedir(), ".codex", "hooks.json") : resolve(homedir(), ".claude", "settings.json");
  const config = readJson(path);
  const script = resolve(dirname(fileURLToPath(import.meta.url)), "hook.js");
  const command = `${shellQuote(process.execPath)} ${shellQuote(script)}`;
  const contextHandler = (statusMessage: string): HookHandler => ({
    type: "command",
    command,
    timeout: 3,
    statusMessage,
    ...(target === "codex" ? { additionalContextLimit: 1800 } : {}),
  });
  const stopHandler: HookHandler = {
    type: "command",
    command,
    timeout: 3,
    statusMessage: "Drafting Engram handoff",
  };

  mergeEvent(config, "SessionStart", remove ? null : { hooks: [contextHandler("Loading Engram project memory")] });
  mergeEvent(config, "UserPromptSubmit", remove ? null : { hooks: [contextHandler("Recalling Engram task context")] });
  mergeEvent(config, "Stop", remove ? null : { hooks: [stopHandler] });
  if (target === "codex" && !remove && !config.description) {
    config.description = "User hooks including Engram cross-agent project memory.";
  }
  writeConfig(path, config);
  return path;
}

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const requested = args.filter((arg) => !arg.startsWith("--"));
const targets = (requested.length ? requested : ["codex"]) as Array<"codex" | "claude">;
if (targets.some((target) => target !== "codex" && target !== "claude")) {
  throw new Error("Targets must be codex and/or claude.");
}

const results = targets.map((target) => ({ target, action: remove ? "removed" : "installed", path: install(target, remove) }));
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
