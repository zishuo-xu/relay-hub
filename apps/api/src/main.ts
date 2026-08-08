import cors from '@fastify/cors';
import {
  AgentEventSchema,
  AgentProfileInputSchema,
  BootstrapPolicySchema,
  CreateTaskInputSchema,
  type RunEvent,
} from '@relay-hub/contracts';
import { createDatabase } from '@relay-hub/db';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { z } from 'zod';
import { checkAgentHealth, listOpenCodeModels } from './agent-runtime-health.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { DEFAULT_RUN_TOKEN_TTL_MS } from './run-token.js';
import { PostgresStore } from './store.js';
import { validateWorkspaceRoot } from './workspace-root.js';

const port = Number(process.env.RELAY_HUB_API_PORT ?? 4100);
const host = process.env.RELAY_HUB_API_HOST ?? '127.0.0.1';
const webOrigin = process.env.RELAY_HUB_WEB_ORIGIN ?? 'http://localhost:3000';

const app = Fastify({ logger: true });
await app.register(cors, { origin: webOrigin });

const io = new SocketServer(app.server, { cors: { origin: webOrigin } });

io.on('connection', (socket) => {
  socket.on('task.subscribe', (taskId: unknown) => {
    if (typeof taskId === 'string' && taskId.length > 0) socket.join(`task:${taskId}`);
  });
  socket.on('task.unsubscribe', (taskId: unknown) => {
    if (typeof taskId === 'string' && taskId.length > 0) socket.leave(`task:${taskId}`);
  });
});

const database = createDatabase();
const runTokenTtlMs = z.coerce
  .number()
  .int()
  .positive()
  .parse(process.env.RELAY_HUB_RUN_TOKEN_TTL_MS ?? DEFAULT_RUN_TOKEN_TTL_MS);
const store = new PostgresStore(database.db, runTokenTtlMs);
const publisher = new OutboxPublisher(database.db, process.env.REDIS_URL);

function readBearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (!authorization) return null;
  const match = /^Bearer (rht_[A-Za-z0-9_-]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

function broadcast(events: RunEvent[]): void {
  for (const event of events) {
    io.to(`task:${event.taskId}`).emit('task.event', {
      eventId: event.id,
      taskId: event.taskId,
      runId: event.runId,
      type: event.type,
      occurredAt: event.occurredAt,
      data: event.payload,
    });
  }
}

app.get('/health', async () => {
  await database.client`select 1`;
  return { status: 'ok', database: 'postgresql', queue: 'bullmq' };
});

app.get('/api/tasks', async () => ({ tasks: await store.listTasks() }));

app.get('/api/workspaces', async () => ({ workspaces: await store.listWorkspaces() }));

app.patch('/api/workspaces/:workspaceId', async (request, reply) => {
  const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
  const input = z
    .object({
      rootPath: z.string().trim().min(1).max(4_096).optional(),
      bootstrapPolicy: BootstrapPolicySchema.optional(),
    })
    .refine((value) => value.rootPath !== undefined || value.bootstrapPolicy !== undefined, {
      message: 'At least one workspace field is required',
    })
    .parse(request.body);
  const canonicalRoot = input.rootPath ? await validateWorkspaceRoot(input.rootPath) : undefined;
  const workspace = await store.updateWorkspace(workspaceId, {
    ...(canonicalRoot ? { rootPath: canonicalRoot } : {}),
    ...(input.bootstrapPolicy ? { bootstrapPolicy: input.bootstrapPolicy } : {}),
  });
  if (!workspace) return reply.code(404).send({ error: 'workspace_not_found' });
  return workspace;
});

app.get('/api/workspaces/:workspaceId/agents', async (request) => {
  const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
  return { agents: await store.listAgentProfiles(workspaceId) };
});

app.post('/api/workspaces/:workspaceId/agents', async (request, reply) => {
  const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
  const input = AgentProfileInputSchema.parse(request.body);
  const agent = await store.createAgentProfile(workspaceId, input);
  if (!agent) return reply.code(404).send({ error: 'workspace_not_found' });
  return reply.code(201).send(agent);
});

app.put('/api/agents/:agentId', async (request, reply) => {
  const { agentId } = z.object({ agentId: z.string().uuid() }).parse(request.params);
  const input = AgentProfileInputSchema.parse(request.body);
  const agent = await store.updateAgentProfile(agentId, input);
  if (!agent) return reply.code(404).send({ error: 'agent_not_found' });
  return agent;
});

app.post('/api/agents/:agentId/health-check', async (request, reply) => {
  const { agentId } = z.object({ agentId: z.string().uuid() }).parse(request.params);
  const agent = await store.getAgentProfile(agentId);
  if (!agent) return reply.code(404).send({ error: 'agent_not_found' });
  return checkAgentHealth(agent);
});

app.get('/api/agent-runtimes/opencode', async (_request, reply) => {
  try {
    const runtime = await listOpenCodeModels();
    return { available: true, ...runtime };
  } catch (error) {
    return reply.code(503).send({
      available: false,
      models: [],
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/tasks', async (request, reply) => {
  const input = CreateTaskInputSchema.parse(request.body);
  const idempotencyHeader = request.headers['idempotency-key'];
  const idempotencyKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;
  const result = await store.createTask(input, idempotencyKey);
  broadcast(result.emitted);
  return reply.code(result.value.created ? 201 : 200).send(result.value.detail);
});

app.get('/api/tasks/:taskId', async (request, reply) => {
  const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
  const detail = await store.getTaskDetail(taskId);
  if (!detail) return reply.code(404).send({ error: 'task_not_found' });
  return detail;
});

app.post('/api/tasks/:taskId/confirm', async (request) => {
  const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
  const result = await store.confirmTaskCompletion(taskId);
  broadcast(result.emitted);
  return result.value;
});

app.get('/api/tasks/:taskId/events', async (request) => {
  const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
  const { after } = z.object({ after: z.coerce.number().int().nonnegative().default(0) }).parse(request.query);
  return { events: await store.getTaskEvents(taskId, after) };
});

app.post('/api/runs/:runId/cancel', async (request) => {
  const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);
  const result = await store.requestRunCancellation(runId);
  broadcast(result.emitted);
  return result.value;
});

app.post('/internal/runs/:runId/claim', async (request, reply) => {
  const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);
  const { workerId } = z.object({ workerId: z.string().min(1).max(120) }).parse(request.body);
  const result = await store.claimRun(runId, workerId);
  if (!result.value) return reply.code(409).send({ error: 'run_not_claimable' });
  broadcast(result.emitted);
  return result.value;
});

app.get('/internal/runs/:runId/control', async (request, reply) => {
  const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);
  const token = readBearerToken(request);
  if (!token || !(await store.authorizeRunToken(runId, token))) {
    return reply.code(401).send({ error: 'invalid_run_token' });
  }
  const status = await store.getRunStatus(runId);
  if (!status) return reply.code(404).send({ error: 'run_not_found' });
  return { status };
});

app.post('/internal/runs/:runId/events', async (request, reply) => {
  const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);
  const token = readBearerToken(request);
  if (!token || !(await store.authorizeRunToken(runId, token))) {
    return reply.code(401).send({ error: 'invalid_run_token' });
  }
  const body = z
    .object({
      dedupeKey: z.string().min(1).max(200),
      event: AgentEventSchema,
    })
    .parse(request.body);
  const result = await store.recordAgentEvent(runId, body.dedupeKey, body.event);
  broadcast(result.emitted);
  return result.value;
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'validation_error', issues: error.issues });
  }
  app.log.error(error);
  const message = error instanceof Error ? error.message : 'Unknown state conflict';
  return reply.code(409).send({ error: 'state_conflict', message });
});

await app.listen({ host, port });
publisher.start();

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await publisher.close();
  io.close();
  await app.close();
  await database.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
