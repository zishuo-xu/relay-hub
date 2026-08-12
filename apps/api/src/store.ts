import type {
  AgentEvent,
  AgentProfileInput,
  AgentProfile,
  BootstrapPolicy,
  ProviderConnection,
  ProviderConnectionInput,
  ClaimedExecution,
  CreateTaskInput,
  CreateThreadInput,
  CreateThreadMessageInput,
  RunEvent,
  RunStatus,
  Task,
  TaskDetail,
  ThreadDetail,
  ThreadSummary,
  Workspace,
} from '@relay-hub/contracts';
import type { RelayDatabase } from '@relay-hub/db';
import {
  authorizeRunToken as authorizeRunTokenInDb,
  claimRun as claimRunInDb,
  getRunStatus as getRunStatusFromDb,
  heartbeatRun as heartbeatRunInDb,
  reconcileExpiredRunLeases as reconcileExpiredRunLeasesInDb,
  requestRunCancellation as requestRunCancellationInDb,
} from './persistence/run-execution-repository.js';
import {
  confirmTaskCompletion as confirmTaskCompletionInDb,
  createTask as createTaskInDb,
  getTaskDetail as getTaskDetailFromDb,
  getTaskEvents as getTaskEventsFromDb,
  listTasks as listTasksFromDb,
} from './persistence/task-repository.js';
import type { MutationResult } from './persistence/types.js';
import {
  createThread as createThreadInDb,
  createThreadMessage as createThreadMessageInDb,
  getThreadDetail as getThreadDetailFromDb,
  listThreads as listThreadsFromDb,
} from './persistence/thread-repository.js';
import {
  createAgentProfile as createAgentProfileInDb,
  getAgentProfile as getAgentProfileFromDb,
  getProviderConnection as getProviderConnectionFromDb,
  listAgentProfiles as listAgentProfilesFromDb,
  listProviderConnections as listProviderConnectionsFromDb,
  listWorkspaces as listWorkspacesFromDb,
  updateWorkspace as updateWorkspaceInDb,
  updateAgentProfile as updateAgentProfileInDb,
  createProviderConnection as createProviderConnectionInDb,
  updateProviderConnection as updateProviderConnectionInDb,
} from './persistence/workspace-repository.js';
import { recordAgentEvent as recordAgentEventInDb } from './persistence/workflow-repository.js';
import { DEFAULT_RUN_TOKEN_TTL_MS } from './run-token.js';
import { DEFAULT_RUN_LEASE_DURATION_MS } from './run-lease.js';

export class PostgresStore {
  constructor(
    private readonly db: RelayDatabase,
    private readonly runTokenTtlMs = DEFAULT_RUN_TOKEN_TTL_MS,
    private readonly runLeaseDurationMs = DEFAULT_RUN_LEASE_DURATION_MS,
  ) {}

  listTasks(): Promise<Task[]> {
    return listTasksFromDb(this.db);
  }

  listThreads(): Promise<ThreadSummary[]> {
    return listThreadsFromDb(this.db);
  }

  getThreadDetail(threadId: string): Promise<ThreadDetail | null> {
    return getThreadDetailFromDb(this.db, threadId);
  }

  createThread(input: CreateThreadInput): Promise<ThreadDetail> {
    return createThreadInDb(this.db, input);
  }

  createThreadMessage(
    threadId: string,
    input: CreateThreadMessageInput,
    idempotencyKey?: string,
  ): Promise<MutationResult<ThreadDetail>> {
    return createThreadMessageInDb(this.db, threadId, input, idempotencyKey);
  }

  listWorkspaces(): Promise<Workspace[]> {
    return listWorkspacesFromDb(this.db);
  }

  updateWorkspace(
    workspaceId: string,
    patch: { rootPath?: string; bootstrapPolicy?: BootstrapPolicy },
  ): Promise<Workspace | null> {
    return updateWorkspaceInDb(this.db, workspaceId, patch);
  }

  listAgentProfiles(workspaceId: string): Promise<AgentProfile[]> {
    return listAgentProfilesFromDb(this.db, workspaceId);
  }

  createAgentProfile(workspaceId: string, input: AgentProfileInput): Promise<AgentProfile | null> {
    return createAgentProfileInDb(this.db, workspaceId, input);
  }

  updateAgentProfile(agentId: string, input: AgentProfileInput): Promise<AgentProfile | null> {
    return updateAgentProfileInDb(this.db, agentId, input);
  }

  getAgentProfile(agentId: string): Promise<AgentProfile | null> {
    return getAgentProfileFromDb(this.db, agentId);
  }

  listProviderConnections(workspaceId: string): Promise<ProviderConnection[]> {
    return listProviderConnectionsFromDb(this.db, workspaceId);
  }

  getProviderConnection(connectionId: string): Promise<ProviderConnection | null> {
    return getProviderConnectionFromDb(this.db, connectionId);
  }

  createProviderConnection(
    workspaceId: string,
    input: ProviderConnectionInput,
  ): Promise<ProviderConnection | null> {
    return createProviderConnectionInDb(this.db, workspaceId, input);
  }

  updateProviderConnection(
    connectionId: string,
    input: ProviderConnectionInput,
  ): Promise<ProviderConnection | null> {
    return updateProviderConnectionInDb(this.db, connectionId, input);
  }

  getTaskDetail(taskId: string): Promise<TaskDetail | null> {
    return getTaskDetailFromDb(this.db, taskId);
  }

  getTaskEvents(taskId: string, afterEventId: number): Promise<RunEvent[]> {
    return getTaskEventsFromDb(this.db, taskId, afterEventId);
  }

  createTask(
    input: CreateTaskInput,
    idempotencyKey?: string,
  ): Promise<MutationResult<{ detail: TaskDetail; created: boolean }>> {
    return createTaskInDb(this.db, input, idempotencyKey);
  }

  confirmTaskCompletion(taskId: string): Promise<MutationResult<TaskDetail>> {
    return confirmTaskCompletionInDb(this.db, taskId);
  }

  claimRun(runId: string, workerId: string): Promise<MutationResult<ClaimedExecution | null>> {
    return claimRunInDb(this.db, runId, workerId, this.runTokenTtlMs, this.runLeaseDurationMs);
  }

  heartbeatRun(runId: string, plaintext: string, now = new Date()): Promise<{ leaseExpiresAt: string } | null> {
    return heartbeatRunInDb(this.db, runId, plaintext, this.runLeaseDurationMs, now);
  }

  reconcileExpiredRunLeases(now = new Date(), runId?: string): Promise<MutationResult<number>> {
    return reconcileExpiredRunLeasesInDb(this.db, now, runId);
  }

  authorizeRunToken(runId: string, plaintext: string, now = new Date()): Promise<boolean> {
    return authorizeRunTokenInDb(this.db, runId, plaintext, now);
  }

  getRunStatus(runId: string): Promise<RunStatus | null> {
    return getRunStatusFromDb(this.db, runId);
  }

  requestRunCancellation(runId: string): Promise<MutationResult<TaskDetail>> {
    return requestRunCancellationInDb(this.db, runId);
  }

  recordAgentEvent(
    runId: string,
    dedupeKey: string,
    agentEvent: AgentEvent,
  ): Promise<MutationResult<TaskDetail>> {
    return recordAgentEventInDb(this.db, runId, dedupeKey, agentEvent);
  }
}
