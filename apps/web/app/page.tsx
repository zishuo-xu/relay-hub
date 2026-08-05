'use client';

import {
  DEFAULT_MOCK_AGENT_ID,
  type AgentProfile,
  type RealtimeEnvelope,
  type RunEvent,
  type Task,
  type TaskDetail,
  type Workspace,
} from '@relay-hub/contracts';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

const apiUrl = process.env.NEXT_PUBLIC_RELAY_HUB_API_URL ?? 'http://127.0.0.1:4100';

const statusLabels: Record<Task['status'], string> = {
  draft: '草稿',
  queued: '排队中',
  running: '执行中',
  reviewing: '审查中',
  changes_requested: '需要修改',
  waiting_for_user: '等待确认',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function eventText(event: RunEvent): string {
  switch (event.type) {
    case 'task.created':
      return `任务已创建，分配给 ${String(event.payload.agentId)}`;
    case 'run.claimed':
      return `Worker ${String(event.payload.workerId)} 已领取任务`;
    case 'run.prepared':
      return `已创建隔离分支 ${String(event.payload.branchName)}，工作目录：${String(event.payload.workingDirectory)}`;
    case 'run.started':
      return 'Agent 开始执行';
    case 'output.delta':
      return String(event.payload.text ?? '');
    case 'tool.called':
      return `调用工具：${String(event.payload.name)}`;
    case 'tool.completed':
      return `工具调用完成：${String(event.payload.callId)}`;
    case 'run.completed':
      return String(event.payload.summary ?? 'Agent 执行完成');
    case 'run.cancellation_requested':
      return '用户已请求取消，正在回收 Codex 子进程。';
    case 'run.cancelled':
      return String(event.payload.reason ?? 'Run 已取消');
    case 'run.failed':
      return `执行失败：${String(event.payload.message ?? event.payload.code)}`;
    default:
      return event.type;
  }
}

export default function HomePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [title, setTitle] = useState('为示例服务增加健康检查接口');
  const [description, setDescription] = useState('分析需求并给出实现结果，记录完整执行时间线。');
  const [criterion, setCriterion] = useState('返回 HTTP 200，并提供可读的状态信息');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(DEFAULT_MOCK_AGENT_ID);

  const loadTasks = useCallback(async () => {
    const response = await fetch(`${apiUrl}/api/tasks`, { cache: 'no-store' });
    if (!response.ok) throw new Error('无法读取任务列表');
    const payload = (await response.json()) as { tasks: Task[] };
    setTasks(payload.tasks);
    setSelectedTaskId((current) => current ?? payload.tasks[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (taskId: string) => {
    const response = await fetch(`${apiUrl}/api/tasks/${taskId}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('无法读取任务详情');
    setDetail((await response.json()) as TaskDetail);
  }, []);

  const loadRuntimeConfiguration = useCallback(async () => {
    const workspaceResponse = await fetch(`${apiUrl}/api/workspaces`, { cache: 'no-store' });
    if (!workspaceResponse.ok) throw new Error('无法读取 Workspace 配置');
    const workspacePayload = (await workspaceResponse.json()) as { workspaces: Workspace[] };
    const currentWorkspace = workspacePayload.workspaces[0];
    if (!currentWorkspace) throw new Error('尚未配置 Workspace');
    setWorkspace(currentWorkspace);
    setWorkspaceRoot(currentWorkspace.rootPath);

    const agentResponse = await fetch(`${apiUrl}/api/workspaces/${currentWorkspace.id}/agents`, {
      cache: 'no-store',
    });
    if (!agentResponse.ok) throw new Error('无法读取 AgentProfile');
    const agentPayload = (await agentResponse.json()) as { agents: AgentProfile[] };
    setAgents(agentPayload.agents.filter((agent) => agent.enabled));
  }, []);

  useEffect(() => {
    loadTasks().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    loadRuntimeConfiguration().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [loadRuntimeConfiguration, loadTasks]);

  useEffect(() => {
    if (!selectedTaskId) {
      setDetail(null);
      return;
    }
    loadDetail(selectedTaskId).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [loadDetail, selectedTaskId]);

  useEffect(() => {
    const socket = io(apiUrl, { transports: ['websocket', 'polling'] });

    const onConnect = () => {
      if (!selectedTaskId) return;
      socket.emit('task.subscribe', selectedTaskId);
      void Promise.all([loadDetail(selectedTaskId), loadTasks()]).catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
    };

    const onTaskEvent = (event: RealtimeEnvelope) => {
      if (event.taskId !== selectedTaskId) return;
      void Promise.all([loadDetail(event.taskId), loadTasks()]).catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
    };
    socket.on('connect', onConnect);
    socket.on('task.event', onTaskEvent);
    return () => {
      if (selectedTaskId) socket.emit('task.unsubscribe', selectedTaskId);
      socket.off('connect', onConnect);
      socket.off('task.event', onTaskEvent);
      socket.disconnect();
    };
  }, [loadDetail, loadTasks, selectedTaskId]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (!workspace) throw new Error('Workspace 尚未加载完成');
      if (workspaceRoot !== workspace.rootPath) {
        const workspaceResponse = await fetch(`${apiUrl}/api/workspaces/${workspace.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rootPath: workspaceRoot }),
        });
        if (!workspaceResponse.ok) {
          const detail = await workspaceResponse.text();
          throw new Error(`Workspace 路径无效：${detail}`);
        }
        const updatedWorkspace = (await workspaceResponse.json()) as Workspace;
        setWorkspace(updatedWorkspace);
        setWorkspaceRoot(updatedWorkspace.rootPath);
      }
      const response = await fetch(`${apiUrl}/api/tasks`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          title,
          description,
          agentId: selectedAgentId,
          acceptanceCriteria: criterion.trim() ? [criterion.trim()] : [],
        }),
      });
      if (!response.ok) throw new Error(`创建任务失败：${response.status}`);
      const created = (await response.json()) as TaskDetail;
      setSelectedTaskId(created.task.id);
      setDetail(created);
      await loadTasks();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelCurrentRun() {
    if (!currentRun) return;
    setError(null);
    const response = await fetch(`${apiUrl}/api/runs/${currentRun.id}/cancel`, { method: 'POST' });
    if (!response.ok) throw new Error(`取消任务失败：${response.status} ${await response.text()}`);
    const updated = (await response.json()) as TaskDetail;
    setDetail(updated);
    await loadTasks();
  }

  const currentRun = useMemo(
    () => detail?.runs.find((run) => run.id === detail.task.currentRunId) ?? null,
    [detail],
  );
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const currentAgent = agents.find((agent) => agent.id === detail?.task.agentId) ?? null;
  const canCancel = currentRun
    ? !['succeeded', 'failed', 'cancelled', 'lost'].includes(currentRun.status)
    : false;

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">MULTI-AGENT CONTROL PLANE</p>
          <h1>RelayHub</h1>
          <p className="subtitle">让 Agent 的执行、状态和协作过程变得可见、可恢复、可追溯。</p>
        </div>
        <div className="system-status"><span /> Phase 2 · Codex Runtime</div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace-grid">
        <aside className="panel task-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">TASKS</p>
              <h2>任务队列</h2>
            </div>
            <span className="count">{tasks.length}</span>
          </div>
          <div className="task-list">
            {tasks.length === 0 ? <p className="empty">创建第一个任务，观察完整执行链。</p> : null}
            {tasks.map((task) => (
              <button
                className={`task-item ${task.id === selectedTaskId ? 'selected' : ''}`}
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
                type="button"
              >
                <span className={`status-dot ${task.status}`} />
                <span className="task-copy">
                  <strong>{task.title}</strong>
                  <small>{statusLabels[task.status]}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel timeline-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">LIVE TIMELINE</p>
              <h2>{detail?.task.title ?? '等待任务'}</h2>
            </div>
            {detail ? <span className={`status-pill ${detail.task.status}`}>{statusLabels[detail.task.status]}</span> : null}
          </div>

          {detail ? (
            <>
              <div className="run-summary">
                <span>Agent <strong>{currentAgent?.name ?? detail.task.agentId}</strong></span>
                <span>Run <code>{currentRun?.id.slice(0, 8) ?? '—'}</code></span>
                <span>Version <strong>{detail.task.version}</strong></span>
                {canCancel ? (
                  <button
                    className="cancel-button"
                    onClick={() => void cancelCurrentRun().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}
                    type="button"
                  >
                    取消 Run
                  </button>
                ) : null}
              </div>
              {currentRun?.worktreePath ? (
                <div className="worktree-note">
                  <strong>{currentRun.branchName}</strong>
                  <code>{currentRun.workingDirectory}</code>
                </div>
              ) : null}
              <ol className="timeline">
                {detail.events.map((event) => (
                  <li key={event.id}>
                    <span className="event-index">{String(event.id).padStart(2, '0')}</span>
                    <div className="event-body">
                      <div className="event-meta">
                        <strong>{event.type}</strong>
                        <time>{new Date(event.occurredAt).toLocaleTimeString('zh-CN')}</time>
                      </div>
                      <p>{eventText(event)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="timeline-placeholder">
              <span>01</span>
              <p>任务创建后，持久化事件会实时出现在这里。</p>
            </div>
          )}
        </section>

        <aside className="panel create-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">NEW TASK</p>
              <h2>创建任务</h2>
            </div>
          </div>
          <form onSubmit={createTask}>
            <label>
              任务标题
              <input minLength={3} onChange={(event) => setTitle(event.target.value)} required value={title} />
            </label>
            <label>
              需求描述
              <textarea onChange={(event) => setDescription(event.target.value)} required rows={5} value={description} />
            </label>
            <label>
              验收标准
              <textarea onChange={(event) => setCriterion(event.target.value)} rows={3} value={criterion} />
            </label>
            <label>
              Git Workspace 路径
              <input
                onChange={(event) => setWorkspaceRoot(event.target.value)}
                required
                value={workspaceRoot}
              />
            </label>
            <label>
              执行 Agent
              <select onChange={(event) => setSelectedAgentId(event.target.value)} value={selectedAgentId}>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </label>
            <div className="agent-choice">
              <span className="agent-mark">{selectedAgent?.adapterType === 'codex_cli' ? 'C' : 'M'}</span>
              <div>
                <strong>{selectedAgent?.name ?? '正在加载 Agent'}</strong>
                <small>{selectedAgent?.adapterType === 'codex_cli' ? '真实 Codex CLI · 隔离 Worktree' : '稳定演示 · 流式输出'}</small>
              </div>
            </div>
            <button className="primary-button" disabled={submitting} type="submit">
              {submitting ? '正在创建…' : '启动任务'}
            </button>
          </form>
        </aside>
      </section>
    </main>
  );
}
