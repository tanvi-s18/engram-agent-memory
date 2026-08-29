import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

function readJson(path: string): JsonObject {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("the top-level value is not an object");
    }
    return parsed as JsonObject;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function configPath(): string {
  if (process.env.CLAUDE_DESKTOP_CONFIG_PATH) return resolve(process.env.CLAUDE_DESKTOP_CONFIG_PATH);
  if (process.platform === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return resolve(process.env.APPDATA, "Claude", "claude_desktop_config.json");
  }
  return resolve(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

const path = configPath();
const remove = process.argv.includes("--remove");
const config = readJson(path);
const existingServers =
  config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
    ? (config.mcpServers as JsonObject)
    : {};

if (remove) {
  delete existingServers.engram;
} else {
  const script = resolve(dirname(fileURLToPath(import.meta.url)), "stdio.js");
  existingServers.engram = {
    command: process.execPath,
    args: [script],
    env: {
      ENGRAM_DB_PATH: resolve(homedir(), ".engram", "engram.db"),
    },
  };
}

if (Object.keys(existingServers).length > 0) config.mcpServers = existingServers;
else delete config.mcpServers;

mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(
  `${JSON.stringify({ action: remove ? "removed" : "installed", connector: "engram", configPath: path }, null, 2)}\n`,
);
