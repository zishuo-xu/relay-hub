'use client';

import {
  DEFAULT_MOCK_AGENT_ID,
  DEFAULT_MOCK_REVIEWER_AGENT_ID,
  defaultExecutionPolicy,
  executionPolicyPreset,
  identifyExecutionPolicyPreset,
  type AgentAdapterType,
  type AgentCapability,
  type AgentHealth,
  type AgentPermissionPreset,
  type AgentProfile,
  type AgentRuntimeDescriptor,
  type CompletionPolicy,
  type ProviderConnection,
  type ProviderProtocol,
  type RealtimeEnvelope,
  type ExecutionPolicy,
  type Task,
  type TaskDetail,
  type Workspace,
} from '@relay-hub/contracts';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import {
  AgentConfigDrawer,
  AppRail,
  CreateTaskDrawer,
  ProviderConnectionDrawer,
  SettingsSidebar,
  SettingsWorkspace,
  TaskSidebar,
  TimelineWorkspace,
} from './dashboard';

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
  const [selectedReviewerAgentId, setSelectedReviewerAgentId] = useState(DEFAULT_MOCK_REVIEWER_AGENT_ID);
  const [completionPolicy, setCompletionPolicy] = useState<CompletionPolicy>('require_user_confirmation');
  const [maxReviewRounds, setMaxReviewRounds] = useState(3);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [agentConfigOpen, setAgentConfigOpen] = useState(false);
  const [agentConfigName, setAgentConfigName] = useState('');
  const [agentConfigCapabilities, setAgentConfigCapabilities] = useState<AgentCapability[]>(['implement']);
  const [agentConfigAdapter, setAgentConfigAdapter] = useState<AgentAdapterType>('opencode_cli');
  const [agentConfigModel, setAgentConfigModel] = useState('');
  const [agentConfigVariant, setAgentConfigVariant] = useState('');
  const [agentConfigAgentName, setAgentConfigAgentName] = useState('');
  const [agentConfigInstructions, setAgentConfigInstructions] = useState('');
  const [agentConfigExecutionPolicy, setAgentConfigExecutionPolicy] = useState<ExecutionPolicy>(
    defaultExecutionPolicy('opencode_cli', ['implement']),
  );
  const [agentConfigPermissionPreset, setAgentConfigPermissionPreset] = useState<AgentPermissionPreset | 'custom'>('builder_standard');
  const [agentConfigSaving, setAgentConfigSaving] = useState(false);
  const [agentRuntimes, setAgentRuntimes] = useState<AgentRuntimeDescriptor[]>([]);
  const [agentHealth, setAgentHealth] = useState<AgentHealth | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentConfigEnabled, setAgentConfigEnabled] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<'connections' | 'agents'>('connections');
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [agentConfigConnectionId, setAgentConfigConnectionId] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionName, setConnectionName] = useState('');
  const [connectionProtocol, setConnectionProtocol] = useState<ProviderProtocol>('openai_chat_completions');
  const [connectionBaseUrl, setConnectionBaseUrl] = useState('');
  const [connectionCredentialEnv, setConnectionCredentialEnv] = useState('');
  const [connectionModels, setConnectionModels] = useState('');
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [connectionChecking, setConnectionChecking] = useState(false);
  const [connectionHealth, setConnectionHealth] = useState<AgentHealth | null>(null);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [connectionEnabled, setConnectionEnabled] = useState(true);
  const [connectionLiveConsent, setConnectionLiveConsent] = useState(false);

  const loadTasks = useCallback(async () => {
    const response = await fetch(`${apiUrl}/api/tasks`, { cache: 'no-store' });
    if (!response.ok) throw new Error('无法读取任务列表');
    const payload = (await response.json()) as { tasks: Task[] };
    setTasks(payload.tasks);
    setSelectedTaskId((current) => current ?? payload.tasks.find((task) => !['completed', 'cancelled'].includes(task.status))?.id ?? payload.tasks[0]?.id ?? null);
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
    const enabledAgents = agentPayload.agents.filter((agent) => agent.enabled);
    setAgents(agentPayload.agents);
    setSelectedAgentId((current) =>
      enabledAgents.some((agent) => agent.id === current && agent.capabilities.includes('implement'))
        ? current
        : enabledAgents.find((agent) => agent.capabilities.includes('implement'))?.id ?? '',
    );
    setSelectedReviewerAgentId((current) =>
      enabledAgents.some((agent) => agent.id === current && agent.capabilities.includes('review'))
        ? current
        : enabledAgents.find((agent) => agent.capabilities.includes('review'))?.id ?? '',
    );
    const connectionResponse = await fetch(`${apiUrl}/api/workspaces/${currentWorkspace.id}/provider-connections`, { cache: 'no-store' });
    if (!connectionResponse.ok) throw new Error('无法读取模型连接');
    const connectionPayload = (await connectionResponse.json()) as { connections: ProviderConnection[] };
    setConnections(connectionPayload.connections);
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
          ...(selectedReviewerAgentId ? { reviewerAgentId: selectedReviewerAgentId } : {}),
          acceptanceCriteria: criterion.trim() ? [criterion.trim()] : [],
          completionPolicy,
          maxReviewRounds,
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

  async function confirmCurrentTask() {
    if (!detail) return;
    setConfirming(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/api/tasks/${detail.task.id}/confirm`, { method: 'POST' });
      if (!response.ok) throw new Error(`确认完成失败：${response.status} ${await response.text()}`);
      setDetail((await response.json()) as TaskDetail);
      await loadTasks();
    } finally {
      setConfirming(false);
    }
  }

  async function openAgentConfiguration(agent?: AgentProfile) {
    setCreateOpen(false);
    setAgentConfigOpen(true);
    setAgentHealth(null);
    setConnectionOpen(false);
    const response = await fetch(`${apiUrl}/api/agent-runtimes`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`无法读取 Agent CLI：${response.status}`);
    const payload = (await response.json()) as { runtimes: AgentRuntimeDescriptor[] };
    setAgentRuntimes(payload.runtimes);
    if (agent) {
      const config = agent.config;
      setEditingAgentId(agent.id);
      setAgentConfigName(agent.name);
      setAgentConfigCapabilities(agent.capabilities.filter(
        (capability): capability is AgentCapability => capability === 'implement' || capability === 'review',
      ));
      setAgentConfigAdapter(agent.adapterType);
      setAgentConfigConnectionId(agent.providerConnectionId ?? '');
      setAgentConfigModel(typeof config.model === 'string' ? config.model : '');
      setAgentConfigVariant(typeof config.variant === 'string' ? config.variant : '');
      setAgentConfigAgentName(typeof config.agentName === 'string' ? config.agentName : '');
      setAgentConfigInstructions(agent.instructions ?? '');
      const policy = agent.executionPolicy ?? defaultExecutionPolicy(agent.adapterType, agent.capabilities);
      setAgentConfigExecutionPolicy(policy);
      setAgentConfigPermissionPreset(identifyExecutionPolicyPreset(agent.adapterType, policy));
      setAgentConfigEnabled(agent.enabled);
      return;
    }
    const openCode = payload.runtimes.find((runtime) => runtime.adapterType === 'opencode_cli');
    const defaultConnection = connections.find((connection) => connection.adapterType === 'opencode_cli' && connection.enabled);
    setEditingAgentId(null);
    setAgentConfigName('');
    setAgentConfigCapabilities(['implement']);
    setAgentConfigAdapter('opencode_cli');
    setAgentConfigConnectionId(defaultConnection?.id ?? '');
    setAgentConfigModel(defaultConnection?.kind === 'custom_api' ? defaultConnection.models[0] ?? '' : openCode?.models[0] ?? '');
    setAgentConfigVariant('');
    setAgentConfigAgentName('');
    setAgentConfigInstructions('');
    const policy = defaultExecutionPolicy('opencode_cli', ['implement']);
    setAgentConfigExecutionPolicy(policy);
    setAgentConfigPermissionPreset('builder_standard');
    setAgentConfigEnabled(true);
  }

  function openSettings(view: 'connections' | 'agents' = 'connections') {
    setCreateOpen(false);
    setAgentConfigOpen(false);
    setConnectionOpen(false);
    setSettingsView(view);
    setSettingsOpen(true);
  }

  function openProviderConnectionConfiguration(connection?: ProviderConnection) {
    setAgentConfigOpen(false);
    setConnectionHealth(null);
    setConnectionLiveConsent(false);
    if (connection) {
      setEditingConnectionId(connection.id);
      setConnectionName(connection.name);
      setConnectionProtocol(connection.protocol === 'cli_managed' ? 'openai_chat_completions' : connection.protocol);
      setConnectionBaseUrl(connection.baseUrl ?? '');
      setConnectionCredentialEnv(connection.credentialEnv ?? '');
      setConnectionModels(connection.models.join('\n'));
      setConnectionEnabled(connection.enabled);
    } else {
      setEditingConnectionId(null);
      setConnectionName('');
      setConnectionProtocol('openai_chat_completions');
      setConnectionBaseUrl('');
      setConnectionCredentialEnv('');
      setConnectionModels('');
      setConnectionEnabled(true);
    }
    setConnectionOpen(true);
  }

  async function checkProviderConnection(mode: 'configuration' | 'live', connectionId = editingConnectionId) {
    if (!connectionId) return;
    setConnectionChecking(true);
    setConnectionHealth(null);
    setError(null);
    try {
      const firstModel = connectionModels.split(/\r?\n|,/).map((model) => model.trim()).find(Boolean);
      const response = await fetch(`${apiUrl}/api/provider-connections/${connectionId}/health-check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, ...(mode === 'live' && firstModel ? { model: firstModel } : {}) }),
      });
      if (!response.ok) throw new Error(`检测连接失败：${response.status} ${await response.text()}`);
      setConnectionHealth((await response.json()) as AgentHealth);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const connection = connections.find((candidate) => candidate.id === connectionId);
      setConnectionHealth({
        status: 'unhealthy',
        adapterType: connection?.adapterType ?? 'opencode_cli',
        checkMode: mode,
        requestAttempted: mode === 'live',
        message,
      });
    } finally {
      setConnectionChecking(false);
    }
  }

  async function saveProviderConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) throw new Error('Workspace 尚未加载完成');
    setConnectionSaving(true);
    setConnectionHealth(null);
    setError(null);
    try {
      const models = connectionModels.split(/\r?\n|,/).map((model) => model.trim()).filter(Boolean);
      const existing = connections.find((connection) => connection.id === editingConnectionId);
      const response = await fetch(
        editingConnectionId
          ? `${apiUrl}/api/provider-connections/${editingConnectionId}`
          : `${apiUrl}/api/workspaces/${workspace.id}/provider-connections`,
        {
          method: editingConnectionId ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: connectionName,
            kind: existing?.kind ?? 'custom_api',
            adapterType: existing?.adapterType ?? 'opencode_cli',
            protocol: existing?.kind === 'official_cli' ? 'cli_managed' : connectionProtocol,
            ...(existing?.kind !== 'official_cli'
              ? {
                  baseUrl: connectionBaseUrl,
                  ...(connectionCredentialEnv.trim() ? { credentialEnv: connectionCredentialEnv.trim() } : {}),
                  models,
                }
              : { models: [] }),
            enabled: connectionEnabled,
          }),
        },
      );
      if (!response.ok) throw new Error(`保存连接失败：${response.status} ${await response.text()}`);
      const saved = (await response.json()) as ProviderConnection;
      setEditingConnectionId(saved.id);
      await loadRuntimeConfiguration();
      setAgentConfigConnectionId(saved.id);
      await checkProviderConnection('configuration', saved.id);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const existing = connections.find((connection) => connection.id === editingConnectionId);
      setConnectionHealth({
        status: 'unhealthy',
        adapterType: existing?.adapterType ?? 'opencode_cli',
        checkMode: 'configuration',
        requestAttempted: false,
        message,
      });
    } finally {
      setConnectionSaving(false);
    }
  }

  async function saveAgentProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) throw new Error('Workspace 尚未加载完成');
    setAgentConfigSaving(true);
    setAgentHealth(null);
    setError(null);
    try {
      const response = await fetch(
        editingAgentId ? `${apiUrl}/api/agents/${editingAgentId}` : `${apiUrl}/api/workspaces/${workspace.id}/agents`,
        {
          method: editingAgentId ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: agentConfigName,
            adapterType: agentConfigAdapter,
            capabilities: agentConfigCapabilities,
            instructions: agentConfigInstructions,
            executionPolicy: agentConfigExecutionPolicy,
            ...(agentConfigAdapter !== 'mock' ? { providerConnectionId: agentConfigConnectionId } : {}),
            ...(agentConfigAdapter === 'opencode_cli'
              ? {
                  model: agentConfigModel,
                  ...(agentConfigVariant.trim() ? { variant: agentConfigVariant.trim() } : {}),
                  ...(agentConfigAgentName.trim() ? { agentName: agentConfigAgentName.trim() } : {}),
                }
              : agentConfigAdapter === 'codex_cli' && agentConfigModel.trim()
                ? { model: agentConfigModel.trim() }
                : {}),
            enabled: agentConfigEnabled,
          }),
        },
      );
      if (!response.ok) throw new Error(`保存 Agent 失败：${response.status} ${await response.text()}`);
      const saved = (await response.json()) as AgentProfile;
      setEditingAgentId(saved.id);
      await loadRuntimeConfiguration();
      if (saved.enabled && agentConfigCapabilities.includes('implement')) setSelectedAgentId(saved.id);
      else if (saved.enabled && agentConfigCapabilities.includes('review')) setSelectedReviewerAgentId(saved.id);
      const healthResponse = await fetch(`${apiUrl}/api/agents/${saved.id}/health-check`, { method: 'POST' });
      if (healthResponse.ok) setAgentHealth((await healthResponse.json()) as AgentHealth);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAgentConfigSaving(false);
    }
  }

  const currentRun = useMemo(
    () => detail?.runs.find((run) => run.id === detail.task.currentRunId) ?? null,
    [detail],
  );
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const selectedReviewer = agents.find((agent) => agent.id === selectedReviewerAgentId) ?? null;
  const canCancel = currentRun
    ? !['succeeded', 'failed', 'cancelled', 'lost'].includes(currentRun.status)
    : false;
  const latestReview = detail?.reviews.at(-1) ?? null;
  const canConfirm = Boolean(
    detail?.task.status === 'waiting_for_user' &&
    latestReview?.verdict === 'approved' &&
    currentRun?.status === 'succeeded',
  );

  return (
    <main className="app-shell">
      <AppRail
        active={settingsOpen ? 'settings' : 'tasks'}
        onSettings={() => openSettings('connections')}
        onTasks={() => setSettingsOpen(false)}
      />
      {settingsOpen ? <>
        <SettingsSidebar onViewChange={setSettingsView} view={settingsView} />
        <SettingsWorkspace
          agents={agents}
          connections={connections}
          onNewAgent={() => void openAgentConfiguration().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}
          onEditAgent={(agent) => void openAgentConfiguration(agent).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}
          onEditConnection={openProviderConnectionConfiguration}
          onNewConnection={() => openProviderConnectionConfiguration()}
          view={settingsView}
        />
      </> : <>
        <TaskSidebar tasks={tasks} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} />
        <TimelineWorkspace
        key={selectedTaskId ?? 'empty'}
        canCancel={canCancel}
        canConfirm={canConfirm}
        confirming={confirming}
        currentRun={currentRun}
        detail={detail}
        error={error}
        onCancel={() => void cancelCurrentRun().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}
        onConfirm={() => void confirmCurrentTask().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}
        onConfigureAgents={() => openSettings('agents')}
        onNewTask={() => {
          setAgentConfigOpen(false);
          setCreateOpen(true);
        }}
        />
      </>}
      <CreateTaskDrawer
        agents={agents.filter((agent) => agent.enabled && agent.capabilities.includes('implement'))}
        criterion={criterion}
        completionPolicy={completionPolicy}
        maxReviewRounds={maxReviewRounds}
        description={description}
        onAgentChange={setSelectedAgentId}
        onReviewerChange={setSelectedReviewerAgentId}
        onClose={() => setCreateOpen(false)}
        onCriterionChange={setCriterion}
        onCompletionPolicyChange={setCompletionPolicy}
        onMaxReviewRoundsChange={setMaxReviewRounds}
        onDescriptionChange={setDescription}
        onSubmit={createTask}
        onTitleChange={setTitle}
        onWorkspaceRootChange={setWorkspaceRoot}
        open={createOpen}
        selectedAgent={selectedAgent}
        selectedAgentId={selectedAgentId}
        reviewerAgents={agents.filter((agent) => agent.enabled && agent.capabilities.includes('review'))}
        selectedReviewer={selectedReviewer}
        selectedReviewerAgentId={selectedReviewerAgentId}
        submitting={submitting}
        title={title}
        workspaceRoot={workspaceRoot}
      />
      <AgentConfigDrawer
        adapterType={agentConfigAdapter}
        agentName={agentConfigAgentName}
        instructions={agentConfigInstructions}
        executionPolicy={agentConfigExecutionPolicy}
        permissionPreset={agentConfigPermissionPreset}
        capabilities={agentConfigCapabilities}
        editing={editingAgentId !== null}
        enabled={agentConfigEnabled}
        connections={connections}
        health={agentHealth}
        model={agentConfigModel}
        runtimes={agentRuntimes}
        name={agentConfigName}
        onAdapterChange={(value) => {
          setAgentConfigAdapter(value);
          setAgentHealth(null);
          const connection = connections.find((candidate) => candidate.adapterType === value && candidate.enabled);
          setAgentConfigConnectionId(connection?.id ?? '');
          if (value === 'opencode_cli') {
            const runtime = agentRuntimes.find((candidate) => candidate.adapterType === value);
            setAgentConfigModel(connection?.kind === 'custom_api' ? connection.models[0] ?? '' : runtime?.models[0] ?? '');
          } else setAgentConfigModel('');
          if (agentConfigPermissionPreset !== 'custom') {
            setAgentConfigExecutionPolicy(executionPolicyPreset(value, agentConfigPermissionPreset));
          }
        }}
        onClose={() => setAgentConfigOpen(false)}
        onAgentNameChange={setAgentConfigAgentName}
        onInstructionsChange={setAgentConfigInstructions}
        onExecutionPolicyChange={(policy) => {
          setAgentConfigExecutionPolicy(policy);
          setAgentConfigPermissionPreset(identifyExecutionPolicyPreset(agentConfigAdapter, policy));
        }}
        onPermissionPresetChange={(preset) => {
          setAgentConfigPermissionPreset(preset);
          if (preset !== 'custom') setAgentConfigExecutionPolicy(executionPolicyPreset(agentConfigAdapter, preset));
        }}
        onCapabilitiesChange={(capabilities) => {
          setAgentConfigCapabilities(capabilities);
          if (agentConfigPermissionPreset !== 'custom') {
            const nextPreset = capabilities.includes('implement') ? 'builder_standard' : 'reviewer_standard';
            setAgentConfigPermissionPreset(nextPreset);
            setAgentConfigExecutionPolicy(executionPolicyPreset(agentConfigAdapter, nextPreset));
          }
        }}
        onEnabledChange={setAgentConfigEnabled}
        onProviderConnectionChange={(value) => {
          setAgentConfigConnectionId(value);
          const connection = connections.find((candidate) => candidate.id === value);
          if (agentConfigAdapter === 'opencode_cli') {
            const runtime = agentRuntimes.find((candidate) => candidate.adapterType === 'opencode_cli');
            setAgentConfigModel(connection?.kind === 'custom_api' ? connection.models[0] ?? '' : runtime?.models[0] ?? '');
          }
        }}
        onModelChange={setAgentConfigModel}
        onNameChange={setAgentConfigName}
        onSubmit={saveAgentProfile}
        onVariantChange={setAgentConfigVariant}
        open={agentConfigOpen}
        saving={agentConfigSaving}
        variant={agentConfigVariant}
        providerConnectionId={agentConfigConnectionId}
      />
      <ProviderConnectionDrawer
        activeAgentCount={agents.filter((agent) => agent.enabled && agent.providerConnectionId === editingConnectionId).length}
        baseUrl={connectionBaseUrl}
        checking={connectionChecking}
        credentialEnv={connectionCredentialEnv}
        editing={editingConnectionId !== null}
        enabled={connectionEnabled}
        health={connectionHealth}
        kind={connections.find((connection) => connection.id === editingConnectionId)?.kind ?? 'custom_api'}
        adapterType={connections.find((connection) => connection.id === editingConnectionId)?.adapterType ?? 'opencode_cli'}
        liveConsent={connectionLiveConsent}
        models={connectionModels}
        name={connectionName}
        onBaseUrlChange={setConnectionBaseUrl}
        onCheck={() => void checkProviderConnection('configuration')}
        onCheckLive={() => void checkProviderConnection('live')}
        onClose={() => setConnectionOpen(false)}
        onCredentialEnvChange={setConnectionCredentialEnv}
        onEnabledChange={setConnectionEnabled}
        onLiveConsentChange={setConnectionLiveConsent}
        onModelsChange={setConnectionModels}
        onNameChange={setConnectionName}
        onProtocolChange={setConnectionProtocol}
        onSubmit={saveProviderConnection}
        open={connectionOpen}
        protocol={connectionProtocol}
        saving={connectionSaving}
        usedModels={[...new Set(agents
          .filter((agent) => agent.enabled && agent.providerConnectionId === editingConnectionId)
          .map((agent) => agent.config.model)
          .filter((model): model is string => typeof model === 'string'))]}
      />
    </main>
  );
}
