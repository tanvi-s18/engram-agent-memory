import { createServer } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { dashboardHtml } from "./dashboard.js";
import { createMemoryMcpServer } from "./mcp.js";
import { MemoryStore } from "./store.js";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.ENGRAM_PORT ?? "4317", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("ENGRAM_PORT must be a valid TCP port");

const store = new MemoryStore();
const mcpHandler = createMcpHandler(() => createMemoryMcpServer(store), { responseMode: "json" });
const nodeMcpHandler = toNodeHandler(mcpHandler, {
  onerror: (error) => console.error("MCP request failed:", error),
});
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

function redirectHome(response: import("node:http").ServerResponse, message?: string): void {
  const suffix = message ? `?message=${encodeURIComponent(message)}` : "";
  response.writeHead(303, { location: `/${suffix}`, "cache-control": "no-store" });
  response.end();
}

const httpServer = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(dashboardHtml(store));
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ ok: true, service: "engram-agent-memory", ...store.stats() }));
    return;
  }

  const proposalAction = url.pathname.match(/^\/api\/proposals\/([0-9a-f-]{36})\/(approve|reject)$/);
  if (request.method === "POST" && proposalAction) {
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;
    try {
      const id = proposalAction[1]!;
      const decision = proposalAction[2] === "approve" ? "approved" : "rejected";
      store.reviewProposal(id, decision);
      redirectHome(response, `Proposal ${decision}.`);
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Could not review proposal" }));
    }
    return;
  }

  if (url.pathname === "/mcp") {
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;
    void nodeMcpHandler(request, response);
    return;
  }

  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Not found", dashboard: "/", mcp: "/mcp", health: "/health" }));
});

httpServer.listen(port, host, () => {
  console.log(`Engram dashboard: http://${host}:${port}/`);
  console.log(`Engram MCP:       http://${host}:${port}/mcp`);
  console.log(`Engram database:  ${store.databasePath}`);
});

async function shutdown(signal: string) {
  console.log(`\n${signal} received; closing Engram.`);
  await mcpHandler.close();
  httpServer.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
