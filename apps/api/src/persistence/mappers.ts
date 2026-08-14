import type {
  AgentAdapterType,
  AgentProfile,
  Consultation,
  Delegation,
  DelegationPlan,
  Handoff,
  MessageDispatch,
  Review,
  ReviewFinding,
  Run,
  RunEvent,
  Task,
  ThreadMessage,
  ThreadSummary,
  Workspace,
  ProviderConnection,
} from '@relay-hub/contracts';
import { defaultExecutionPolicy, effectiveExecutionPolicyForAdapter, ExecutionPolicySchema } from '@relay-hub/contracts';
import {
  agentProfiles,
  consultations,
  delegationPlans,
  delegations,
  handoffs,
  messageDispatches,
  providerConnections,
  reviewFindings,
  reviews,
  runEvents,
  runs,
  tasks,
  threadMessages,
  threads,
  workspaces,
} from '@relay-hub/db';

type TaskRow = typeof tasks.$inferSelect;
type ConsultationRow = typeof consultations.$inferSelect;
type DelegationPlanRow = typeof delegationPlans.$inferSelect;
type DelegationRow = typeof delegations.$inferSelect;
type ThreadRow = typeof threads.$inferSelect;
type ThreadMessageRow = typeof threadMessages.$inferSelect;
type MessageDispatchRow = typeof messageDispatches.$inferSelect;
type RunRow = typeof runs.$inferSelect;
type RunEventRow = typeof runEvents.$inferSelect;
type WorkspaceRow = typeof workspaces.$inferSelect;
type AgentProfileRow = typeof agentProfiles.$inferSelect;
type ProviderConnectionRow = typeof providerConnections.$inferSelect;
type HandoffRow = typeof handoffs.$inferSelect;
type ReviewRow = typeof reviews.$inferSelect;
type ReviewFindingRow = typeof reviewFindings.$inferSelect;

function toIso(value: Date): string {
  return value.toISOString();
}

export function mapTask(row: TaskRow, fallbackAgentId: string): Task {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ...(row.threadId ? { threadId: row.threadId } : {}),
    ...(row.parentTaskId ? { parentTaskId: row.parentTaskId } : {}),
    ...(row.conversationContextBeforeSequence !== null
      ? { conversationContextBeforeSequence: row.conversationContextBeforeSequence }
      : {}),
    ...(row.conversationContextPolicyVersion !== null
      ? { conversationContextPolicyVersion: row.conversationContextPolicyVersion }
      : {}),
    title: row.title,
    description: row.description,
    agentId: row.builderAgentId ?? fallbackAgentId,
    collaborationMode: row.collaborationMode,
    collaboratorAgentIds: row.collaboratorAgentIds,
    ...(row.reviewerAgentId ? { reviewerAgentId: row.reviewerAgentId } : {}),
    acceptanceCriteria: row.acceptanceCriteria,
    completionPolicy: row.completionPolicy,
    maxReviewRounds: row.maxReviewRounds,
    status: row.status,
    currentRunId: row.currentRunId ?? '',
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function mapDelegationPlan(row: DelegationPlanRow): DelegationPlan {
  return {
    id: row.id,
    parentTaskId: row.parentTaskId,
    sourceRunId: row.sourceRunId,
    sourceAgentId: row.sourceAgentId,
    reportingMode: row.reportingMode,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    ...(row.continuationRunId ? { continuationRunId: row.continuationRunId } : {}),
  };
}

export function mapDelegation(row: DelegationRow): Delegation {
  return {
    id: row.id,
    planId: row.planId,
    targetAgentId: row.targetAgentId,
    kind: row.kind,
    title: row.title,
    objective: row.objective,
    scope: row.scope,
    deliverables: row.deliverables,
    acceptanceCriteria: row.acceptanceCriteria,
    requiredSpecialties: row.requiredSpecialties,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    ...(row.reviewerAgentId ? { reviewerAgentId: row.reviewerAgentId } : {}),
    ...(row.childThreadId ? { childThreadId: row.childThreadId } : {}),
    ...(row.childTaskId ? { childTaskId: row.childTaskId } : {}),
    ...(row.report ? { report: row.report } : {}),
  };
}

export function mapThreadSummary(
  row: ThreadRow,
  aggregate: { messageCount: number; activeTaskCount: number; lastMessage?: string },
): ThreadSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    messageCount: aggregate.messageCount,
    activeTaskCount: aggregate.activeTaskCount,
    ...(aggregate.lastMessage ? { lastMessage: aggregate.lastMessage } : {}),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function mapThreadMessage(row: ThreadMessageRow): ThreadMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    sequence: row.sequence,
    senderType: row.senderType,
    senderName: row.senderName,
    content: row.content,
    createdAt: toIso(row.createdAt),
    ...(row.taskId ? { taskId: row.taskId } : {}),
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.senderAgentId ? { senderAgentId: row.senderAgentId } : {}),
    ...(row.recipientAgentId ? { recipientAgentId: row.recipientAgentId } : {}),
  };
}

export function mapMessageDispatch(row: MessageDispatchRow): MessageDispatch {
  return {
    id: row.id,
    messageId: row.messageId,
    taskId: row.taskId,
    agentId: row.agentId,
    createdAt: toIso(row.createdAt),
  };
}

export function mapConsultation(row: ConsultationRow): Consultation {
  return {
    id: row.id,
    taskId: row.taskId,
    sourceRunId: row.sourceRunId,
    sourceAgentId: row.sourceAgentId,
    targetAgentId: row.targetAgentId,
    question: row.question,
    contextSummary: row.contextSummary,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    ...(row.targetRunId ? { targetRunId: row.targetRunId } : {}),
    ...(row.continuationRunId ? { continuationRunId: row.continuationRunId } : {}),
    ...(row.response ? { response: row.response } : {}),
  };
}

export function mapHandoff(row: HandoffRow): Handoff {
  return {
    id: row.id,
    bundleVersion: row.bundleVersion,
    sourceRunId: row.sourceRunId,
    targetAgentId: row.targetAgentId,
    objective: row.objective,
    contextSummary: row.contextSummary,
    artifactRefs: row.artifactRefs,
    evidenceRefs: row.evidenceRefs,
    acceptanceCriteria: row.acceptanceCriteria,
    decisions: row.decisions,
    openQuestions: row.openQuestions,
    risks: row.risks,
    status: row.status,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    ...(row.targetRunId ? { targetRunId: row.targetRunId } : {}),
    ...(row.nextAction ? { nextAction: row.nextAction } : {}),
    ...(row.contentDigest ? { contentDigest: row.contentDigest } : {}),
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
  const snapshot = row.agentProfileSnapshot;
  const policyResult = ExecutionPolicySchema.safeParse(snapshot.executionPolicy ?? snapshot.config.executionPolicy);
  const snapshotPolicy = policyResult.success
    ? policyResult.data
    : defaultExecutionPolicy(snapshot.adapterType, snapshot.capabilities);
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    status: row.status,
    attempt: row.attempt,
    triggerType: row.triggerType,
    workspaceRoot: row.workspaceRoot,
    bootstrapPolicySnapshot: row.bootstrapPolicySnapshot,
    agentProfileSnapshot: {
      id: snapshot.id,
      name: snapshot.name,
      adapterType: snapshot.adapterType,
      capabilities: snapshot.capabilities,
      specialties: snapshot.specialties ?? [],
      executionPolicy: effectiveExecutionPolicyForAdapter(snapshot.adapterType, snapshotPolicy, row.triggerType),
      ...(snapshot.provider ? { provider: snapshot.provider } : {}),
      ...(snapshot.modelLabel ? { modelLabel: snapshot.modelLabel } : {}),
      ...(snapshot.modelFamily ? { modelFamily: snapshot.modelFamily } : {}),
    },
    version: row.version,
    createdAt: toIso(row.createdAt),
    ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
    ...(row.retryOfRunId ? { retryOfRunId: row.retryOfRunId } : {}),
    ...(row.worktreePath ? { worktreePath: row.worktreePath } : {}),
    ...(row.workingDirectory ? { workingDirectory: row.workingDirectory } : {}),
    ...(row.branchName ? { branchName: row.branchName } : {}),
    ...(row.workerId ? { workerId: row.workerId } : {}),
    ...(row.leaseExpiresAt ? { leaseExpiresAt: toIso(row.leaseExpiresAt) } : {}),
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
  if (
    row.adapterType !== 'mock' &&
    row.adapterType !== 'codex_cli' &&
    row.adapterType !== 'opencode_cli' &&
    row.adapterType !== 'claude_code'
  ) {
    throw new Error(`Unsupported adapter type: ${row.adapterType}`);
  }
  const adapterType: AgentAdapterType = row.adapterType;
  const policyResult = ExecutionPolicySchema.safeParse(row.config.executionPolicy);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    adapterType,
    ...(row.providerConnectionId ? { providerConnectionId: row.providerConnectionId } : {}),
    capabilities: row.capabilities,
    specialties: row.specialties,
    config: row.config,
    instructions: typeof row.config.instructions === 'string' ? row.config.instructions : '',
    executionPolicy: policyResult.success
      ? policyResult.data
      : defaultExecutionPolicy(adapterType, row.capabilities),
    enabled: row.enabled,
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.modelLabel ? { modelLabel: row.modelLabel } : {}),
    ...(row.modelFamily ? { modelFamily: row.modelFamily } : {}),
  };
}

export function mapProviderConnection(row: ProviderConnectionRow): ProviderConnection {
  if (row.adapterType !== 'codex_cli' && row.adapterType !== 'opencode_cli' && row.adapterType !== 'claude_code') {
    throw new Error(`Unsupported provider connection adapter: ${row.adapterType}`);
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    kind: row.kind,
    adapterType: row.adapterType,
    protocol: row.protocol,
    models: row.models,
    enabled: row.enabled,
    credentialConfigured: Boolean(row.credentialSecret),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
    ...(row.credentialEnv ? { credentialEnv: row.credentialEnv } : {}),
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
