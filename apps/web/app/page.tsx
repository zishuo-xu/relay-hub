'use client';

import {
  DEFAULT_MOCK_AGENT_ID,
  type AgentProfile,
  type RealtimeEnvelope,
  type Task,
  type TaskDetail,
  type Workspace,
} from '@relay-hub/contracts';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { AppRail, CreateTaskDrawer, TaskSidebar, TimelineWorkspace } from './dashboard';

const apiUrl = process.env.NEXT_PUBLIC_RELAY_HUB_API_URL ?? 'http://127.0.0.1:4100';

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
  const [createOpen, setCreateOpen] = useState(false);

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
      setCreateOpen(false);
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
    <main className="app-shell">
      <AppRail />
      <TaskSidebar tasks={tasks} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} />
      <TimelineWorkspace
        canCancel={canCancel}
        currentAgent={currentAgent}
        currentRun={currentRun}
        detail={detail}
        error={error}
        onCancel={() => void cancelCurrentRun().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}
        onNewTask={() => setCreateOpen(true)}
      />
      <CreateTaskDrawer
        agents={agents}
        criterion={criterion}
        description={description}
        onAgentChange={setSelectedAgentId}
        onClose={() => setCreateOpen(false)}
        onCriterionChange={setCriterion}
        onDescriptionChange={setDescription}
        onSubmit={createTask}
        onTitleChange={setTitle}
        onWorkspaceRootChange={setWorkspaceRoot}
        open={createOpen}
        selectedAgent={selectedAgent}
        selectedAgentId={selectedAgentId}
        submitting={submitting}
        title={title}
        workspaceRoot={workspaceRoot}
      />
    </main>
  );
}
