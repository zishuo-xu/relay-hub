import type {
  AgentAdapterType,
  AgentProfile,
  Handoff,
  Review,
  ReviewFinding,
  Run,
  RunEvent,
  Task,
  Workspace,
} from '@relay-hub/contracts';
import {
  agentProfiles,
  handoffs,
  reviewFindings,
  reviews,
  runEvents,
  runs,
  tasks,
  workspaces,
} from '@relay-hub/db';

type TaskRow = typeof tasks.$inferSelect;
type RunRow = typeof runs.$inferSelect;
type RunEventRow = typeof runEvents.$inferSelect;
type WorkspaceRow = typeof workspaces.$inferSelect;
type AgentProfileRow = typeof agentProfiles.$inferSelect;
type HandoffRow = typeof handoffs.$inferSelect;
type ReviewRow = typeof reviews.$inferSelect;
type ReviewFindingRow = typeof reviewFindings.$inferSelect;

function toIso(value: Date): string {
  return value.toISOString();
}

export function mapTask(row: TaskRow, agentId: string): Task {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    description: row.description,
    agentId,
    ...(row.reviewerAgentId ? { reviewerAgentId: row.reviewerAgentId } : {}),
    acceptanceCriteria: row.acceptanceCriteria,
    completionPolicy: row.completionPolicy,
    status: row.status,
    currentRunId: row.currentRunId ?? '',
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function mapHandoff(row: HandoffRow): Handoff {
  return {
    id: row.id,
    sourceRunId: row.sourceRunId,
    targetAgentId: row.targetAgentId,
    objective: row.objective,
    contextSummary: row.contextSummary,
    artifactRefs: row.artifactRefs,
    acceptanceCriteria: row.acceptanceCriteria,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    ...(row.targetRunId ? { targetRunId: row.targetRunId } : {}),
  };
}

export function mapReviewFinding(row: ReviewFindingRow): ReviewFinding {
  return {
    id: row.id,
    reviewId: row.reviewId,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    createdAt: toIso(row.createdAt),
    ...(row.filePath ? { filePath: row.filePath } : {}),
    ...(row.lineStart !== null ? { lineStart: row.lineStart } : {}),
    ...(row.lineEnd !== null ? { lineEnd: row.lineEnd } : {}),
    ...(row.suggestion ? { suggestion: row.suggestion } : {}),
  };
}

export function mapReview(row: ReviewRow, findings: ReviewFinding[]): Review {
  return {
    id: row.id,
    taskId: row.taskId,
    runId: row.runId,
    round: row.round,
    verdict: row.verdict,
    summary: row.summary,
    findings,
    createdAt: toIso(row.createdAt),
  };
}

export function mapRun(row: RunRow): Run {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    status: row.status,
    attempt: row.attempt,
    triggerType: row.triggerType,
    workspaceRoot: row.workspaceRoot,
    bootstrapPolicySnapshot: row.bootstrapPolicySnapshot,
    version: row.version,
    createdAt: toIso(row.createdAt),
    ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
    ...(row.retryOfRunId ? { retryOfRunId: row.retryOfRunId } : {}),
    ...(row.worktreePath ? { worktreePath: row.worktreePath } : {}),
    ...(row.workingDirectory ? { workingDirectory: row.workingDirectory } : {}),
    ...(row.branchName ? { branchName: row.branchName } : {}),
    ...(row.workerId ? { workerId: row.workerId } : {}),
    ...(row.sessionRef ? { sessionRef: row.sessionRef } : {}),
    ...(row.failureCode ? { failureCode: row.failureCode } : {}),
    ...(row.failureDetail ? { failureDetail: row.failureDetail } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.startedAt ? { startedAt: toIso(row.startedAt) } : {}),
    ...(row.finishedAt ? { finishedAt: toIso(row.finishedAt) } : {}),
  };
}

export function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.rootPath,
    bootstrapPolicy: row.bootstrapPolicy,
    defaultCompletionPolicy: row.defaultCompletionPolicy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function mapAgentProfile(row: AgentProfileRow): AgentProfile {
  if (row.adapterType !== 'mock' && row.adapterType !== 'codex_cli') {
    throw new Error(`Unsupported adapter type: ${row.adapterType}`);
  }
  const adapterType: AgentAdapterType = row.adapterType;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    adapterType,
    capabilities: row.capabilities,
    enabled: row.enabled,
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.modelLabel ? { modelLabel: row.modelLabel } : {}),
    ...(row.modelFamily ? { modelFamily: row.modelFamily } : {}),
  };
}

export function mapEvent(row: RunEventRow): RunEvent {
  return {
    id: row.id,
    taskId: row.taskId,
    runId: row.runId,
    type: row.eventType,
    payload: row.payload,
    source: row.source,
    occurredAt: toIso(row.occurredAt),
    dedupeKey: row.dedupeKey,
  };
}
