import cors from '@fastify/cors';
import { AgentEventSchema, CreateTaskInputSchema, type RunEvent } from '@relay-hub/contracts';
import { createDatabase } from '@relay-hub/db';
import Fastify from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { z } from 'zod';
import { OutboxPublisher } from './outbox-publisher.js';
import { PostgresStore } from './store.js';

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
const store = new PostgresStore(database.db);
const publisher = new OutboxPublisher(database.db, process.env.REDIS_URL);

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

app.get('/api/tasks/:taskId/events', async (request) => {
  const { taskId } = z.object({ taskId: z.string().uuid() }).parse(request.params);
  const { after } = z.object({ after: z.coerce.number().int().nonnegative().default(0) }).parse(request.query);
  return { events: await store.getTaskEvents(taskId, after) };
});

app.post('/internal/runs/:runId/claim', async (request, reply) => {
  const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);
  const { workerId } = z.object({ workerId: z.string().min(1).max(120) }).parse(request.body);
  const result = await store.claimRun(runId, workerId);
  if (!result.value) return reply.code(409).send({ error: 'run_not_claimable' });
  broadcast(result.emitted);
  return result.value;
});

app.post('/internal/runs/:runId/events', async (request) => {
  const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);
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
