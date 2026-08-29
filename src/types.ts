export const MEMORY_KINDS = [
  "decision",
  "constraint",
  "preference",
  "discovery",
  "failed_attempt",
  "handoff",
  "observation",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryStatus = "active" | "superseded";
export type ProposalStatus = "pending" | "approved" | "rejected";

export interface Memory {
  id: string;
  workspace: string;
  branch: string | null;
  kind: MemoryKind;
  content: string;
  sourceAgent: string;
  sourceSession: string | null;
  sourceCommit: string | null;
  confidence: number;
  status: MemoryStatus;
  filePaths: string[];
  fileFingerprints: Record<string, string | null>;
  supersedesId: string | null;
  expiresAt: string | null;
  invalidatedAt: string | null;
  invalidationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RememberInput {
  workspace: string;
  branch?: string;
  kind: MemoryKind;
  content: string;
  sourceAgent?: string;
  sourceSession?: string;
  sourceCommit?: string;
  confidence?: number;
  filePaths?: string[];
  fileFingerprints?: Record<string, string | null>;
  expiresAt?: string;
  supersedesId?: string;
}

export interface RecallInput {
  workspace: string;
  query?: string;
  branch?: string;
  kinds?: MemoryKind[];
  limit?: number;
}

export interface Proposal {
  id: string;
  workspace: string;
  branch: string | null;
  kind: MemoryKind;
  content: string;
  sourceAgent: string;
  sourceSession: string | null;
  sourceCommit: string | null;
  confidence: number;
  filePaths: string[];
  fileFingerprints: Record<string, string | null>;
  evidence: Record<string, unknown>;
  signature: string;
  status: ProposalStatus;
  approvedMemoryId: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

export interface ProposeInput extends Omit<RememberInput, "expiresAt" | "supersedesId"> {
  signature: string;
  evidence?: Record<string, unknown>;
}

export interface AgentSession {
  id: string;
  workspace: string;
  repoRoot: string;
  branchStart: string | null;
  commitStart: string | null;
  changedFilesStart: string[];
  task: string | null;
  sourceAgent: string;
  startedAt: string;
  updatedAt: string;
}

export interface SessionInput {
  id: string;
  workspace: string;
  repoRoot: string;
  branchStart?: string | null;
  commitStart?: string | null;
  changedFilesStart?: string[];
  task?: string | null;
  sourceAgent: string;
}
