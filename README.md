# Engram

Engram is a local-first persistent memory layer shared by coding agents. It combines automatic lifecycle hooks with an optional MCP interface, stores concise and attributable records in SQLite, and keeps generated handoffs untrusted until a person approves them.

Engram is an independent project. It stores project identifiers as metadata, but it is not tied to any particular repository or application.

> [!IMPORTANT]
> Engram is local developer tooling, not a secrets manager. Its SQLite database is not encrypted. Never store credentials, private keys, access tokens, or sensitive personal data in memory.

## Requirements

- Node.js 22.13 or newer
- pnpm 11
- Git for repository detection and stale-memory checks
- macOS, Linux, or Windows for the MCP/CLI surfaces; automatic hook support depends on the agent client

## How the automatic workflow works

1. `SessionStart` detects the Git root, branch, commit, and working tree, then injects a small set of approved project memories.
2. `UserPromptSubmit` retrieves memories relevant to the current task and adds them as explicitly untrusted historical context.
3. `Stop` combines the agent's final response with Git evidence to create or update one pending handoff for the session.
4. You approve or reject the draft at `http://127.0.0.1:4317/`. Only approved drafts enter recall.
5. On later sessions, file fingerprints and Git history checks quarantine memories whose referenced files have changed.

Hooks read and write SQLite directly, so automatic recall and handoff capture still work if the dashboard/MCP daemon is not running. The daemon is needed only for the browser UI and MCP clients.

## Included surfaces

- Review inbox and memory ledger at `http://127.0.0.1:4317/`
- Streamable HTTP MCP endpoint at `http://127.0.0.1:4317/mcp`
- Local stdio MCP connector for ordinary Claude Desktop chats
- Codex and Claude Code lifecycle-hook adapter
- CLI for inspection, approval, rejection, and manual memory operations
- SQLite + FTS5 persistence at `~/.engram/engram.db`
- Repository, branch, source-agent, source-session, commit, confidence, expiry, file fingerprint, and provenance metadata
- Secret-pattern rejection and stale-memory quarantine

## Build and run

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Override the database path when needed:

```bash
ENGRAM_DB_PATH=/absolute/path/to/engram.db pnpm start
```

## Install automatic hooks

After building, install the user-level hooks for Codex:

```bash
node dist/src/install-hooks.js codex
```

For Codex and Claude Code:

```bash
node dist/src/install-hooks.js codex claude
```

The installer merges Engram into existing hook configuration and preserves unrelated hooks. Remove only Engram's entries with:

```bash
node dist/src/install-hooks.js codex claude --remove
```

Codex may ask you to review and trust newly installed hook commands before they run. Claude Code reads the same lifecycle events from `~/.claude/settings.json`.

## Connect the optional MCP interface

Claude Desktop Chat (Claude Code is not required):

```bash
node dist/src/install-claude-desktop.js
```

Fully quit and reopen Claude Desktop after installation. In a chat, open the `+` menu and check **Connectors** for Engram. The desktop connector launches Engram itself, so the web daemon on port 4317 does not need to be running. Remove it without disturbing other Claude settings with:

```bash
node dist/src/install-claude-desktop.js --remove
```

The installer merges an `engram` entry into Claude Desktop's existing `mcpServers` configuration and preserves unrelated preferences and connectors.

Because the generated client configuration contains the absolute path to this checkout, rerun the relevant installer after moving or renaming the Engram folder.

Other MCP clients can use the optional HTTP daemon:

Codex:

```bash
codex mcp add engram --url http://127.0.0.1:4317/mcp
```

Claude Code:

```bash
claude mcp add --transport http --scope user engram http://127.0.0.1:4317/mcp
```

The MCP tools are `memory_workspaces`, `memory_recall`, `memory_remember`, `memory_handoff`, `memory_supersede`, and `memory_forget`.

## CLI

The current repository is detected automatically unless `--workspace` is provided.

```bash
pnpm cli -- detect
pnpm cli -- recall --query "persistence"
pnpm cli -- proposals --status pending
pnpm cli -- approve --id <proposal-uuid>
pnpm cli -- reject --id <proposal-uuid>
pnpm cli -- remember --kind decision --content "Use SQLite for local persistence."
pnpm cli -- refresh
```

## Trust model

Recalled memories are historical context, not instructions or current facts. Agents are told to verify them against the current user request, repository, and tests. Automatic summaries remain proposals until approval. Engram rejects several obvious credential formats, but that filter is not a substitute for reviewing a draft before approving it.

## Security and privacy

- The default database is `~/.engram/engram.db` and is never intended to be committed.
- The dashboard and HTTP MCP server bind to `127.0.0.1` and validate localhost hosts and origins. Do not expose them through a public reverse proxy or change the binding to a public interface.
- Claude Desktop and coding-agent integrations execute this checkout with your user permissions. Review the code and install only from a release or commit you trust.
- MCP tools can write, supersede, and delete memories after the client grants tool access. Automatic end-of-session handoffs use the review inbox before they become recallable.
- Secret detection is best-effort and cannot guarantee that all sensitive values will be caught.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and supported-version information.

## Development

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm build
```

The repository intentionally excludes databases, build output, dependencies, logs, and local agent configuration. CI runs type-checking, tests, and a production dependency audit.

## License

MIT
