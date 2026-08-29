import type { MemoryStore } from "./store.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function dashboardHtml(store: MemoryStore): string {
  const stats = store.stats();
  const proposals = store.proposals("pending", undefined, 40);
  const memories = store.list(undefined, 60);
  const proposalCards = proposals.length
    ? proposals
        .map(
          (proposal) => `
            <article class="proposal">
              <header>
                <div><span class="kind">${escapeHtml(proposal.kind.replaceAll("_", " "))}</span><span class="status pending">needs review</span></div>
                <span class="source">${escapeHtml(proposal.sourceAgent)} · ${escapeHtml(displayDate(proposal.updatedAt))}</span>
              </header>
              <p>${escapeHtml(proposal.content)}</p>
              ${
                proposal.filePaths.length
                  ? `<div class="files"><strong>Git-linked files</strong>${proposal.filePaths
                      .slice(0, 20)
                      .map((path) => `<code>${escapeHtml(path)}</code>`)
                      .join("")}</div>`
                  : ""
              }
              <div class="actions">
                <form method="post" action="/api/proposals/${encodeURIComponent(proposal.id)}/approve">
                  <button class="approve" type="submit">Approve memory</button>
                </form>
                <form method="post" action="/api/proposals/${encodeURIComponent(proposal.id)}/reject">
                  <button class="reject" type="submit">Reject</button>
                </form>
                <code>${escapeHtml(proposal.id)}</code>
              </div>
            </article>`,
        )
        .join("")
    : `<div class="empty"><strong>Review inbox is clear.</strong><span>Completed coding turns with meaningful changes will appear here first.</span></div>`;

  const memoryCards = memories.length
    ? memories
        .map(
          (memory) => `
            <article class="memory ${memory.status === "superseded" || memory.invalidatedAt ? "muted" : ""}">
              <header>
                <div><span class="kind">${escapeHtml(memory.kind.replaceAll("_", " "))}</span><span class="status">${escapeHtml(
                  memory.invalidatedAt ? "stale" : memory.status,
                )}</span></div>
                <span class="source">${escapeHtml(displayDate(memory.updatedAt))}</span>
              </header>
              <p>${escapeHtml(memory.content)}</p>
              ${
                memory.invalidationReason
                  ? `<div class="warning"><strong>Excluded from recall:</strong> ${escapeHtml(memory.invalidationReason)}</div>`
                  : ""
              }
              <dl>
                <div><dt>Workspace</dt><dd>${escapeHtml(memory.workspace)}</dd></div>
                <div><dt>Agent</dt><dd>${escapeHtml(memory.sourceAgent)}</dd></div>
                <div><dt>Commit</dt><dd>${escapeHtml(memory.sourceCommit?.slice(0, 12) ?? "—")}</dd></div>
                <div><dt>ID</dt><dd><code>${escapeHtml(memory.id)}</code></dd></div>
              </dl>
            </article>`,
        )
        .join("")
    : `<div class="empty"><strong>No approved memories yet.</strong><span>Approve a handoff above or save one through an agent.</span></div>`;

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Engram · Agent Memory</title>
      <style>
        :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; background: #0b0d0c; color: #eef2ed; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 80% -10%, #1c3a2d 0, transparent 38%), #0b0d0c; }
        main { width: min(1080px, calc(100% - 36px)); margin: 0 auto; padding: 64px 0 90px; }
        .eyebrow { color: #70e0a3; text-transform: uppercase; letter-spacing: .14em; font: 700 12px/1 ui-monospace, monospace; }
        h1 { margin: 14px 0 10px; font-size: clamp(42px, 8vw, 82px); letter-spacing: -.06em; line-height: .96; }
        .lede { max-width: 700px; margin: 0; color: #aeb8b1; font-size: 18px; line-height: 1.6; }
        .health { display: inline-flex; align-items: center; gap: 9px; margin-top: 22px; padding: 9px 13px; border: 1px solid #294736; border-radius: 999px; background: #112019; color: #bff7d3; font-size: 13px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #63e895; box-shadow: 0 0 18px #63e895; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 42px 0; }
        .stat { padding: 20px; border: 1px solid #252a26; border-radius: 18px; background: rgba(18, 21, 19, .82); }
        .stat strong { display: block; font-size: 30px; letter-spacing: -.04em; }
        .stat span { color: #89928b; font-size: 13px; }
        .endpoint { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 42px; padding: 18px 20px; border: 1px solid #28332c; border-radius: 15px; background: #111613; }
        .endpoint span, .source { color: #8e9991; font-size: 12px; }
        code { font-family: "SFMono-Regular", Consolas, monospace; color: #a8efc2; word-break: break-all; }
        h2 { margin: 0 0 8px; font-size: 22px; }
        .section-lede { color: #89928b; margin: 0 0 18px; font-size: 14px; }
        .stack { display: grid; gap: 12px; }
        .section { margin-top: 46px; }
        .memory, .proposal { padding: 20px; border: 1px solid #252b27; border-radius: 18px; background: rgba(17, 20, 18, .88); }
        .proposal { border-color: #405d4a; box-shadow: inset 3px 0 #61d991; }
        .memory.muted { opacity: .58; }
        .memory header, .proposal header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .memory header > div, .proposal header > div { display: flex; gap: 8px; }
        .kind, .status { display: inline-block; padding: 5px 8px; border-radius: 8px; font: 700 11px/1 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .08em; }
        .kind { color: #81e7a8; background: #163222; }
        .status { color: #a7afa9; background: #252b27; }
        .status.pending { color: #f6d48a; background: #392f18; }
        .memory p, .proposal p { margin: 16px 0 18px; color: #e5eae6; white-space: pre-wrap; line-height: 1.55; }
        .proposal p { max-height: 420px; overflow: auto; }
        .files { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: 16px 0; color: #89928b; font-size: 12px; }
        .files code { padding: 4px 7px; border-radius: 6px; background: #0b100d; color: #9bc5aa; }
        .actions { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; padding-top: 16px; border-top: 1px solid #283029; }
        .actions form { margin: 0; }
        .actions > code { margin-left: auto; color: #637068; font-size: 10px; }
        button { appearance: none; border: 0; border-radius: 9px; padding: 9px 13px; color: #07110a; font: 700 12px/1 system-ui, sans-serif; cursor: pointer; }
        button.approve { background: #70e0a3; }
        button.reject { color: #c5ccc7; background: #303632; }
        button:hover { filter: brightness(1.12); }
        dl { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; margin: 0; color: #7f8982; font-size: 12px; }
        dl div:last-child { grid-column: 1 / -1; }
        dt { margin-bottom: 3px; color: #5e6861; }
        dd { margin: 0; overflow: hidden; text-overflow: ellipsis; }
        .warning { margin: 0 0 16px; padding: 10px 12px; border-radius: 9px; background: #302616; color: #e7c887; font-size: 12px; }
        .empty { display: grid; gap: 8px; padding: 42px; border: 1px dashed #344039; border-radius: 18px; color: #7f8982; text-align: center; }
        .empty strong { color: #dfe6e1; }
        @media (max-width: 760px) { main { padding-top: 38px; } .stats { grid-template-columns: 1fr 1fr; } .endpoint, .memory header, .proposal header { align-items: flex-start; flex-direction: column; } dl { grid-template-columns: 1fr; } .actions > code { width: 100%; margin: 4px 0 0; } }
      </style>
    </head>
    <body>
      <main>
        <div class="eyebrow">Local-first shared context</div>
        <h1>Engram</h1>
        <p class="lede">Persistent, inspectable memory for coding agents. Agents propose what to remember; you decide what becomes trusted context.</p>
        <div class="health"><span class="dot"></span>Memory service is running</div>
        <section class="stats" aria-label="Memory statistics">
          <div class="stat"><strong>${stats.pending}</strong><span>awaiting review</span></div>
          <div class="stat"><strong>${stats.active}</strong><span>approved memories</span></div>
          <div class="stat"><strong>${stats.invalidated}</strong><span>stale quarantined</span></div>
          <div class="stat"><strong>${stats.workspaces}</strong><span>workspaces</span></div>
        </section>
        <div class="endpoint"><span>MCP Streamable HTTP endpoint</span><code>http://127.0.0.1:4317/mcp</code></div>
        <section>
          <h2>Review inbox</h2>
          <p class="section-lede">Drafts are generated from the agent's final message and current Git evidence. They are never recalled until approved.</p>
          <div class="stack">${proposalCards}</div>
        </section>
        <section class="section">
          <h2>Memory ledger</h2>
          <p class="section-lede">Every memory keeps its source agent, session, commit, file links, and lifecycle state.</p>
          <div class="stack">${memoryCards}</div>
        </section>
      </main>
    </body>
  </html>`;
}
