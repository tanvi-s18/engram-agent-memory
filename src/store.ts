import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertSafeMemory } from "./security.js";
import type {
  AgentSession,
  Memory,
  MemoryKind,
  Proposal,
  ProposalStatus,
  ProposeInput,
  RecallInput,
  RememberInput,
  SessionInput,
} from "./types.js";

interface MemoryRow {
  id: string;
  workspace: string;
  branch: string | null;
  kind: MemoryKind;
  content: string;
  source_agent: string;
  source_session: string | null;
  source_commit: string | null;
  confidence: number;
  status: "active" | "superseded";
  file_paths: string;
  file_fingerprints: string;
  supersedes_id: string | null;
  expires_at: string | null;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  created_at: string;
  updated_at: string;
  rank?: number;
}

interface ProposalRow {
  id: string;
  workspace: string;
  branch: string | null;
  kind: MemoryKind;
  content: string;
  source_agent: string;
  source_session: string | null;
  source_commit: string | null;
  confidence: number;
  file_paths: string;
  file_fingerprints: string;
  evidence: string;
  signature: string;
  status: ProposalStatus;
  approved_memory_id: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
}

interface SessionRow {
  id: string;
  workspace: string;
  repo_root: string;
  branch_start: string | null;
  commit_start: string | null;
  changed_files_start: string;
  task: string | null;
  source_agent: string;
  started_at: string;
  updated_at: string;
}

const MAX_CONTENT_LENGTH = 12_000;

export function defaultDatabasePath(): string {
  return resolve(process.env.ENGRAM_DB_PATH ?? resolve(homedir(), ".engram", "engram.db"));
}

function normalizeWorkspace(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("workspace is required");
  return trimmed.replace(/\\/g, "/").replace(/\/$/, "");
}

function normalizeContent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("content is required");
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    throw new Error(`content must be ${MAX_CONTENT_LENGTH.toLocaleString()} characters or fewer`);
  }
  assertSafeMemory(trimmed);
  return trimmed;
}

function normalizeFilePaths(paths: string[] | undefined): string[] {
  return [...new Set((paths ?? []).map((path) => path.trim().replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean))].slice(
    0,
    250,
  );
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    workspace: row.workspace,
    branch: row.branch,
    kind: row.kind,
    content: row.content,
    sourceAgent: row.source_agent,
    sourceSession: row.source_session,
    sourceCommit: row.source_commit,
    confidence: row.confidence,
    status: row.status,
    filePaths: parseJson<string[]>(row.file_paths, []),
    fileFingerprints: parseJson<Record<string, string | null>>(row.file_fingerprints, {}),
    supersedesId: row.supersedes_id,
    expiresAt: row.expires_at,
    invalidatedAt: row.invalidated_at,
    invalidationReason: row.invalidation_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    workspace: row.workspace,
    branch: row.branch,
    kind: row.kind,
    content: row.content,
    sourceAgent: row.source_agent,
    sourceSession: row.source_session,
    sourceCommit: row.source_commit,
    confidence: row.confidence,
    filePaths: parseJson<string[]>(row.file_paths, []),
    fileFingerprints: parseJson<Record<string, string | null>>(row.file_fingerprints, {}),
    evidence: parseJson<Record<string, unknown>>(row.evidence, {}),
    signature: row.signature,
    status: row.status,
    approvedMemoryId: row.approved_memory_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
  };
}

function rowToSession(row: SessionRow): AgentSession {
  return {
    id: row.id,
    workspace: row.workspace,
    repoRoot: row.repo_root,
    branchStart: row.branch_start,
    commitStart: row.commit_start,
    changedFilesStart: parseJson<string[]>(row.changed_files_start, []),
    task: row.task,
    sourceAgent: row.source_agent,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

function searchExpression(query: string): string | null {
  const terms = query
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_./:-]{1,}/g)
    ?.slice(0, 12);
  if (!terms?.length) return null;
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

export class MemoryStore {
  readonly databasePath: string;
  private readonly db: DatabaseSync;

  constructor(databasePath = defaultDatabasePath()) {
    this.databasePath = resolve(databasePath);
    mkdirSync(dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private ensureColumn(table: string, name: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        branch TEXT,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        source_agent TEXT NOT NULL DEFAULT 'unknown',
        source_session TEXT,
        source_commit TEXT,
        confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
        file_paths TEXT NOT NULL DEFAULT '[]',
        file_fingerprints TEXT NOT NULL DEFAULT '{}',
        supersedes_id TEXT REFERENCES memories(id),
        expires_at TEXT,
        invalidated_at TEXT,
        invalidation_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("memories", "invalidated_at", "TEXT");
    this.ensureColumn("memories", "invalidation_reason", "TEXT");
    this.ensureColumn("memories", "file_fingerprints", "TEXT NOT NULL DEFAULT '{}'");

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS memories_workspace_status_idx
        ON memories(workspace, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS memories_branch_idx
        ON memories(workspace, branch, status);

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        id UNINDEXED,
        workspace UNINDEXED,
        content,
        tokenize = 'unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts(id, workspace, content) VALUES (new.id, new.workspace, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        DELETE FROM memory_fts WHERE id = old.id;
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF content, workspace ON memories BEGIN
        DELETE FROM memory_fts WHERE id = old.id;
        INSERT INTO memory_fts(id, workspace, content) VALUES (new.id, new.workspace, new.content);
      END;

      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        branch TEXT,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        source_agent TEXT NOT NULL,
        source_session TEXT,
        source_commit TEXT,
        confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
        file_paths TEXT NOT NULL DEFAULT '[]',
        file_fingerprints TEXT NOT NULL DEFAULT '{}',
        evidence TEXT NOT NULL DEFAULT '{}',
        signature TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        approved_memory_id TEXT REFERENCES memories(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        reviewed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS proposals_signature_idx ON proposals(signature);
      CREATE INDEX IF NOT EXISTS proposals_status_idx ON proposals(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS proposals_session_idx ON proposals(source_agent, source_session, status);

      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        repo_root TEXT NOT NULL,
        branch_start TEXT,
        commit_start TEXT,
        changed_files_start TEXT NOT NULL DEFAULT '[]',
        task TEXT,
        source_agent TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_sessions_workspace_idx ON agent_sessions(workspace, updated_at DESC);
    `);
    this.ensureColumn("proposals", "file_fingerprints", "TEXT NOT NULL DEFAULT '{}'");
  }

  remember(input: RememberInput): { memory: Memory; created: boolean } {
    const workspace = normalizeWorkspace(input.workspace);
    const content = normalizeContent(input.content);
    const confidence = Math.max(0, Math.min(1, input.confidence ?? 0.8));
    const existing = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE workspace = ? AND kind = ? AND content = ? AND status = 'active' AND invalidated_at IS NULL
         LIMIT 1`,
      )
      .get(workspace, input.kind, content) as MemoryRow | undefined;

    if (existing) return { memory: rowToMemory(existing), created: false };

    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO memories (
          id, workspace, branch, kind, content, source_agent, source_session,
          source_commit, confidence, file_paths, file_fingerprints, supersedes_id, expires_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        workspace,
        input.branch?.trim() || null,
        input.kind,
        content,
        input.sourceAgent?.trim() || "unknown",
        input.sourceSession?.trim() || null,
        input.sourceCommit?.trim() || null,
        confidence,
        JSON.stringify(normalizeFilePaths(input.filePaths)),
        JSON.stringify(input.fileFingerprints ?? {}),
        input.supersedesId ?? null,
        input.expiresAt ?? null,
        now,
        now,
      );

    return { memory: this.get(id)!, created: true };
  }

  get(id: string): Memory | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  recall(input: RecallInput): Memory[] {
    const workspace = normalizeWorkspace(input.workspace);
    const limit = Math.max(1, Math.min(25, input.limit ?? 8));
    const kinds = input.kinds ?? [];
    const now = new Date().toISOString();
    const expression = input.query ? searchExpression(input.query) : null;
    const kindSql = kinds.length ? ` AND m.kind IN (${kinds.map(() => "?").join(", ")})` : "";
    const branchOrder = input.branch ? "CASE WHEN m.branch = ? THEN 0 WHEN m.branch IS NULL THEN 1 ELSE 2 END," : "";

    const parameters: Array<string | number> = [];
    let sql: string;
    if (expression) {
      sql = `
        SELECT m.*, bm25(memory_fts) AS rank
        FROM memory_fts
        JOIN memories m ON m.id = memory_fts.id
        WHERE memory_fts MATCH ?
          AND m.workspace = ?
          AND m.status = 'active'
          AND m.invalidated_at IS NULL
          AND (m.expires_at IS NULL OR m.expires_at > ?)
          ${kindSql}
        ORDER BY ${branchOrder} rank ASC, m.confidence DESC, m.updated_at DESC
        LIMIT ?`;
      parameters.push(expression, workspace, now, ...kinds);
    } else {
      sql = `
        SELECT m.*
        FROM memories m
        WHERE m.workspace = ?
          AND m.status = 'active'
          AND m.invalidated_at IS NULL
          AND (m.expires_at IS NULL OR m.expires_at > ?)
          ${kindSql}
        ORDER BY ${branchOrder} m.confidence DESC, m.updated_at DESC
        LIMIT ?`;
      parameters.push(workspace, now, ...kinds);
    }
    if (input.branch) parameters.push(input.branch);
    parameters.push(limit);

    const rows = this.db.prepare(sql).all(...parameters) as unknown as MemoryRow[];
    return rows.map(rowToMemory);
  }

  list(workspace?: string, limit = 100): Memory[] {
    const boundedLimit = Math.max(1, Math.min(500, limit));
    const rows = workspace
      ? (this.db
          .prepare("SELECT * FROM memories WHERE workspace = ? ORDER BY updated_at DESC LIMIT ?")
          .all(normalizeWorkspace(workspace), boundedLimit) as unknown as MemoryRow[])
      : (this.db
          .prepare("SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?")
          .all(boundedLimit) as unknown as MemoryRow[]);
    return rows.map(rowToMemory);
  }

  validatable(workspace: string): Memory[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE workspace = ? AND status = 'active' AND invalidated_at IS NULL
           AND file_paths != '[]' AND (source_commit IS NOT NULL OR file_fingerprints != '{}')`,
      )
      .all(normalizeWorkspace(workspace)) as unknown as MemoryRow[];
    return rows.map(rowToMemory);
  }

  invalidate(id: string, reason: string): boolean {
    const now = new Date().toISOString();
    return (
      Number(
        this.db
          .prepare(
            `UPDATE memories SET invalidated_at = ?, invalidation_reason = ?, updated_at = ?
             WHERE id = ? AND status = 'active' AND invalidated_at IS NULL`,
          )
          .run(now, reason.slice(0, 2_000), now, id).changes,
      ) > 0
    );
  }

  supersede(id: string, replacement: Omit<RememberInput, "supersedesId" | "workspace">): Memory {
    const previous = this.get(id);
    if (!previous) throw new Error(`Memory ${id} was not found.`);
    if (previous.status !== "active") throw new Error(`Memory ${id} is not active.`);
    const now = new Date().toISOString();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE memories SET status = 'superseded', updated_at = ? WHERE id = ?").run(now, id);
      const result = this.remember({ ...replacement, workspace: previous.workspace, supersedesId: id });
      this.db.exec("COMMIT");
      return result.memory;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  forget(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes) > 0;
  }

  upsertSession(input: SessionInput): AgentSession {
    const workspace = normalizeWorkspace(input.workspace);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_sessions (
          id, workspace, repo_root, branch_start, commit_start, changed_files_start,
          task, source_agent, started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          branch_start = CASE WHEN agent_sessions.workspace != excluded.workspace THEN excluded.branch_start ELSE agent_sessions.branch_start END,
          commit_start = CASE WHEN agent_sessions.workspace != excluded.workspace THEN excluded.commit_start ELSE agent_sessions.commit_start END,
          changed_files_start = CASE WHEN agent_sessions.workspace != excluded.workspace THEN excluded.changed_files_start ELSE agent_sessions.changed_files_start END,
          workspace = excluded.workspace,
          repo_root = excluded.repo_root,
          task = COALESCE(excluded.task, agent_sessions.task),
          source_agent = excluded.source_agent,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.id,
        workspace,
        resolve(input.repoRoot),
        input.branchStart ?? null,
        input.commitStart ?? null,
        JSON.stringify(normalizeFilePaths(input.changedFilesStart)),
        input.task?.trim().slice(0, 8_000) || null,
        input.sourceAgent.trim() || "unknown",
        now,
        now,
      );
    return this.getSession(input.id)!;
  }

  getSession(id: string): AgentSession | null {
    const row = this.db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  propose(input: ProposeInput): { proposal: Proposal; created: boolean } {
    const workspace = normalizeWorkspace(input.workspace);
    const content = normalizeContent(input.content);
    const signature = input.signature.trim();
    if (!signature) throw new Error("proposal signature is required");
    const duplicate = this.db.prepare("SELECT * FROM proposals WHERE signature = ?").get(signature) as ProposalRow | undefined;
    if (duplicate) return { proposal: rowToProposal(duplicate), created: false };

    const now = new Date().toISOString();
    const id = randomUUID();
    const confidence = Math.max(0, Math.min(1, input.confidence ?? 0.75));
    const sessionProposal = input.sourceSession
      ? (this.db
          .prepare(
            `SELECT * FROM proposals
             WHERE source_agent = ? AND source_session = ? AND workspace = ? AND status = 'pending'
             ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(input.sourceAgent?.trim() || "unknown", input.sourceSession, workspace) as ProposalRow | undefined)
      : undefined;

    if (sessionProposal) {
      this.db
        .prepare(
          `UPDATE proposals SET branch = ?, kind = ?, content = ?, source_commit = ?, confidence = ?,
             file_paths = ?, file_fingerprints = ?, evidence = ?, signature = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.branch?.trim() || null,
          input.kind,
          content,
          input.sourceCommit?.trim() || null,
          confidence,
          JSON.stringify(normalizeFilePaths(input.filePaths)),
          JSON.stringify(input.fileFingerprints ?? {}),
          JSON.stringify(input.evidence ?? {}),
          signature,
          now,
          sessionProposal.id,
        );
      return { proposal: this.getProposal(sessionProposal.id)!, created: false };
    }

    this.db
      .prepare(
        `INSERT INTO proposals (
          id, workspace, branch, kind, content, source_agent, source_session, source_commit,
          confidence, file_paths, file_fingerprints, evidence, signature, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        workspace,
        input.branch?.trim() || null,
        input.kind,
        content,
        input.sourceAgent?.trim() || "unknown",
        input.sourceSession?.trim() || null,
        input.sourceCommit?.trim() || null,
        confidence,
        JSON.stringify(normalizeFilePaths(input.filePaths)),
        JSON.stringify(input.fileFingerprints ?? {}),
        JSON.stringify(input.evidence ?? {}),
        signature,
        now,
        now,
      );
    return { proposal: this.getProposal(id)!, created: true };
  }

  getProposal(id: string): Proposal | null {
    const row = this.db.prepare("SELECT * FROM proposals WHERE id = ?").get(id) as ProposalRow | undefined;
    return row ? rowToProposal(row) : null;
  }

  proposals(status?: ProposalStatus, workspace?: string, limit = 100): Proposal[] {
    const boundedLimit = Math.max(1, Math.min(500, limit));
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];
    if (status) {
      clauses.push("status = ?");
      parameters.push(status);
    }
    if (workspace) {
      clauses.push("workspace = ?");
      parameters.push(normalizeWorkspace(workspace));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    parameters.push(boundedLimit);
    const rows = this.db
      .prepare(`SELECT * FROM proposals ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...parameters) as unknown as ProposalRow[];
    return rows.map(rowToProposal);
  }

  reviewProposal(id: string, decision: "approved" | "rejected"): Proposal {
    const proposal = this.getProposal(id);
    if (!proposal) throw new Error(`Proposal ${id} was not found.`);
    if (proposal.status !== "pending") throw new Error(`Proposal ${id} was already ${proposal.status}.`);
    const now = new Date().toISOString();

    if (decision === "rejected") {
      this.db
        .prepare("UPDATE proposals SET status = 'rejected', reviewed_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, id);
      return this.getProposal(id)!;
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const remembered = this.remember({
        workspace: proposal.workspace,
        branch: proposal.branch ?? undefined,
        kind: proposal.kind,
        content: proposal.content,
        sourceAgent: proposal.sourceAgent,
        sourceSession: proposal.sourceSession ?? undefined,
        sourceCommit: proposal.sourceCommit ?? undefined,
        confidence: proposal.confidence,
        filePaths: proposal.filePaths,
        fileFingerprints: proposal.fileFingerprints,
      });
      this.db
        .prepare(
          `UPDATE proposals SET status = 'approved', approved_memory_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(remembered.memory.id, now, now, id);
      this.db.exec("COMMIT");
      return this.getProposal(id)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  stats(): { total: number; active: number; invalidated: number; pending: number; workspaces: number } {
    const memoryRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'active' AND invalidated_at IS NULL THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN invalidated_at IS NOT NULL THEN 1 ELSE 0 END) AS invalidated,
                COUNT(DISTINCT workspace) AS workspaces
         FROM memories`,
      )
      .get() as { total: number; active: number | null; invalidated: number | null; workspaces: number };
    const proposalRow = this.db.prepare("SELECT COUNT(*) AS pending FROM proposals WHERE status = 'pending'").get() as {
      pending: number;
    };
    return {
      total: memoryRow.total,
      active: memoryRow.active ?? 0,
      invalidated: memoryRow.invalidated ?? 0,
      pending: proposalRow.pending,
      workspaces: memoryRow.workspaces,
    };
  }

  close(): void {
    this.db.close();
  }
}
