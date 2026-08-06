import type {
  AgentEvent,
  AgentProfile,
  BootstrapPolicy,
  ClaimedExecution,
  CreateTaskInput,
  RunEvent,
  RunStatus,
  Task,
  TaskDetail,
  Workspace,
} from '@relay-hub/contracts';
import type { RelayDatabase } from '@relay-hub/db';
import {
  authorizeRunToken as authorizeRunTokenInDb,
  claimRun as claimRunInDb,
  getRunStatus as getRunStatusFromDb,
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
  listAgentProfiles as listAgentProfilesFromDb,
  listWorkspaces as listWorkspacesFromDb,
  updateWorkspace as updateWorkspaceInDb,
} from './persistence/workspace-repository.js';
import { recordAgentEvent as recordAgentEventInDb } from './persistence/workflow-repository.js';
import { DEFAULT_RUN_TOKEN_TTL_MS } from './run-token.js';

export class PostgresStore {
  constructor(
    private readonly db: RelayDatabase,
    private readonly runTokenTtlMs = DEFAULT_RUN_TOKEN_TTL_MS,
  ) {}

  listTasks(): Promise<Task[]> {
    return listTasksFromDb(this.db);
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
    return claimRunInDb(this.db, runId, workerId, this.runTokenTtlMs);
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
