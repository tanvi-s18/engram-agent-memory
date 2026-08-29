import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMemoryMcpServer } from "./mcp.js";
import { MemoryStore } from "./store.js";

const stores = new Set<MemoryStore>();

serveStdio(() => {
  const store = new MemoryStore();
  stores.add(store);
  return createMemoryMcpServer(store);
}, {
  onerror(error) {
    process.stderr.write(`[engram] ${error.message}\n`);
  },
});

async function shutdown(): Promise<void> {
  for (const store of stores) {
    try {
      store.close();
    } catch {
      // The MCP connection may already have released the database.
    }
  }
  stores.clear();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
