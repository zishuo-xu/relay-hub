'use client';

import type {
  AgentAdapterType,
  AgentCapability,
  AgentHealth,
  AgentProfile,
  AgentProfileSnapshotSummary,
  AgentRuntimeDescriptor,
  CompletionPolicy,
  RunEvent,
  Task,
  TaskDetail,
} from '@relay-hub/contracts';
import { type FormEvent, useState } from 'react';

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

const eventLabels: Record<string, string> = {
  'task.created': '任务已创建',
  'run.claimed': 'Worker 已领取',
  'run.prepared': '隔离环境就绪',
  'run.bootstrap_started': '正在准备环境',
  'run.bootstrap_step_completed': '准备步骤完成',
  'run.bootstrap_completed': '环境准备完成',
  'run.bootstrap_failed': '环境准备失败',
  'run.started': 'Agent 已启动',
  'output.delta': 'Agent 输出',
  'tool.called': '工具调用',
  'tool.completed': '工具完成',
  'run.completed': '执行结束',
  'handoff.requested': '已准备交接',
  'task.waiting_for_review': '等待审查',
  'task.review_requested': '进入审查',
  'task.review_run_completed': 'Reviewer 执行完成',
  'review.submitted': 'Reviewer 已提交结论',
  'task.review_approved': '审查通过',
  'task.changes_requested': 'Reviewer 要求修改',
  'task.review_blocked': '审查受阻',
  'task.review_failed': 'Reviewer 执行失败',
  'task.repair_requested': '已创建返工 Run',
  'task.repair_limit_reached': '返工轮次已达上限',
  'task.user_confirmed': '用户确认完成',
  'run.cancellation_requested': '正在取消',
  'run.cancelled': '已取消',
  'run.failed': '执行失败',
};

function eventText(event: RunEvent): string {
  switch (event.type) {
    case 'task.created':
      return `任务已分配给 ${String(event.payload.agentId)}`;
    case 'run.claimed':
      return `Worker ${String(event.payload.workerId)} 已领取任务`;
    case 'run.prepared':
      return `已创建隔离分支 ${String(event.payload.branchName)}`;
    case 'run.bootstrap_started':
      return `开始执行 ${String(event.payload.stepCount)} 个 Workspace 准备步骤`;
    case 'run.bootstrap_step_completed':
      return `${String(event.payload.name)} 已完成：${String(event.payload.command)}`;
    case 'run.bootstrap_completed':
      return `Workspace 环境准备完成，耗时 ${String(event.payload.durationMs)}ms`;
    case 'run.bootstrap_failed':
      return `${String(event.payload.name)} 失败：${String(event.payload.message)}`;
    case 'run.started':
      return 'Agent 开始执行';
    case 'output.delta':
      return String(event.payload.text ?? '');
    case 'tool.called':
      return `调用 ${String(event.payload.name)}`;
    case 'tool.completed':
      return `工具调用 ${String(event.payload.callId)} 已结束`;
    case 'run.completed':
      return String(
        event.payload.outcome && typeof event.payload.outcome === 'object'
          ? (event.payload.outcome as { summary?: unknown }).summary ?? 'Agent 执行完成'
          : event.payload.summary ?? 'Agent 执行完成',
      );
    case 'handoff.requested': {
      const handoff = event.payload.handoff as { targetAgentId?: unknown; summary?: unknown } | undefined;
      return `Builder 已准备交接给 ${String(handoff?.targetAgentId ?? 'Reviewer')}：${String(handoff?.summary ?? '')}`;
    }
    case 'task.waiting_for_review':
      return 'Builder 已完成执行；Reviewer 工作流尚未启用，等待用户检查。';
    case 'task.review_requested':
      return `Builder 结果已持久化，并创建 Reviewer Run ${String(event.payload.targetRunId ?? '')}。`;
    case 'task.review_run_completed':
      return 'Reviewer Run 已完成，正在根据完成策略更新任务状态。';
    case 'review.submitted': {
      const review = event.payload.review as { verdict?: unknown; summary?: unknown; findings?: unknown[] } | undefined;
      return `${String(review?.verdict ?? 'unknown')} · ${String(review?.summary ?? '')} · ${review?.findings?.length ?? 0} findings`;
    }
    case 'task.review_approved':
      return event.payload.reason === 'auto_on_approval' || event.payload.reason === 'risk_evidence_satisfied'
        ? 'Reviewer 已批准，CompletionPolicy 已自动完成任务。'
        : 'Reviewer 已批准，等待用户最终确认。';
    case 'task.changes_requested':
      return `Reviewer 要求修改，共 ${String(event.payload.findingCount ?? 0)} 个 Finding。`;
    case 'task.review_blocked':
      return 'Reviewer 报告阻塞问题，需要用户处理。';
    case 'task.review_failed':
      return `Reviewer 执行失败，已转交用户处理：${String(event.payload.message ?? event.payload.reason)}`;
    case 'task.repair_requested':
      return `根据 Review #${String(event.payload.reviewRound)} 创建 Builder 修复 Run ${String(event.payload.repairRunId ?? '')}，完成后进入 Review #${String(event.payload.nextReviewRound)}。`;
    case 'task.repair_limit_reached':
      return 'Reviewer 仍要求修改，但已达到最大审查轮数，转交用户处理。';
    case 'task.user_confirmed':
      return '用户已确认 Reviewer 结论，任务完成。';
    case 'run.cancellation_requested':
      return '用户已请求取消，正在回收 Agent 子进程。';
    case 'run.cancelled':
      return String(event.payload.reason ?? 'Run 已取消');
    case 'run.failed':
      return `执行失败：${String(event.payload.message ?? event.payload.code)}`;
    default:
      return event.type;
  }
}

function eventTone(event: RunEvent): string {
  if (event.type === 'run.failed' || event.type === 'run.cancelled' || event.type === 'run.bootstrap_failed') return 'danger';
  if (
    event.type === 'run.completed' ||
    event.type === 'run.bootstrap_completed' ||
    event.type === 'task.review_approved' ||
    event.type === 'task.user_confirmed'
  ) return 'success';
  if (
    event.type === 'task.changes_requested' ||
    event.type === 'task.review_blocked' ||
    event.type === 'task.review_failed' ||
    event.type === 'task.repair_limit_reached'
  ) return 'danger';
  if (event.type === 'output.delta') return 'output';
  if (event.type.startsWith('tool.')) return 'tool';
  return 'system';
}

export function AppRail() {
  return (
    <nav aria-label="主导航" className="app-rail">
      <div aria-label="RelayHub" className="rail-brand">R</div>
      <div aria-current="page" className="rail-item" title="任务控制台">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 5.5h14M5 12h14M5 18.5h9" />
          <circle cx="3" cy="5.5" r="1" />
          <circle cx="3" cy="12" r="1" />
          <circle cx="3" cy="18.5" r="1" />
        </svg>
      </div>
      <div className="rail-spacer" />
      <div className="rail-runtime" title="本地运行时在线"><span /></div>
    </nav>
  );
}

interface TaskSidebarProps {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

export function TaskSidebar({ tasks, selectedTaskId, onSelectTask }: TaskSidebarProps) {
  const [taskFilter, setTaskFilter] = useState<'focus' | 'all'>('focus');
  const focusStatuses: Task['status'][] = [
    'draft',
    'queued',
    'running',
    'reviewing',
    'changes_requested',
    'waiting_for_user',
    'failed',
  ];
  const focusCount = tasks.filter((task) => focusStatuses.includes(task.status)).length;
  const visibleTasks = taskFilter === 'all'
    ? tasks
    : tasks.filter((task) => focusStatuses.includes(task.status) || task.id === selectedTaskId);

  return (
    <aside className="task-sidebar">
      <header className="product-header">
        <strong>RelayHub</strong>
        <span>Agent workspace</span>
      </header>
      <div className="sidebar-heading">
        <div>
          <p>任务</p>
          <span>{focusCount > 0 ? `${focusCount} 个需要关注` : '当前没有待处理任务'}</span>
        </div>
      </div>
      <div className="task-filters" aria-label="任务筛选">
        <button
          aria-pressed={taskFilter === 'focus'}
          className={taskFilter === 'focus' ? 'active' : ''}
          onClick={() => setTaskFilter('focus')}
          type="button"
        >
          待处理 <span>{focusCount}</span>
        </button>
        <button
          aria-pressed={taskFilter === 'all'}
          className={taskFilter === 'all' ? 'active' : ''}
          onClick={() => setTaskFilter('all')}
          type="button"
        >
          全部 <span>{tasks.length}</span>
        </button>
      </div>
      <div className="task-list">
        {tasks.length === 0 ? <p className="empty">创建第一个任务，观察完整执行链。</p> : null}
        {visibleTasks.length === 0 && tasks.length > 0 ? (
          <p className="empty">没有待处理任务，可以切换到“全部”查看历史记录。</p>
        ) : null}
        {visibleTasks.map((task) => (
          <button
            className={`task-item ${task.id === selectedTaskId ? 'selected' : ''}`}
            key={task.id}
            onClick={() => onSelectTask(task.id)}
            type="button"
          >
            <span className={`status-dot ${task.status}`} />
            <span className="task-copy">
              <strong>{task.title}</strong>
              <span className="task-meta">
                <small>{statusLabels[task.status]}</small>
                <code>{task.id.slice(0, 6)}</code>
              </span>
            </span>
          </button>
        ))}
      </div>
      <footer className="sidebar-footer">
        <span className="footer-status"><i />Local runtime</span>
        <span>Phase 3</span>
      </footer>
    </aside>
  );
}

type CurrentRun = TaskDetail['runs'][number] | null;

interface TimelineWorkspaceProps {
  detail: TaskDetail | null;
  currentRun: CurrentRun;
  currentAgent: AgentProfile | AgentProfileSnapshotSummary | null;
  canCancel: boolean;
  canConfirm: boolean;
  confirming: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onConfigureAgents: () => void;
  onNewTask: () => void;
}

export function TimelineWorkspace({
  detail,
  currentRun,
  currentAgent,
  canCancel,
  canConfirm,
  confirming,
  error,
  onCancel,
  onConfirm,
  onConfigureAgents,
  onNewTask,
}: TimelineWorkspaceProps) {
  const [workspaceView, setWorkspaceView] = useState<'overview' | 'activity'>('overview');
  const latestReview = detail?.reviews.at(-1);
  const milestoneEvents = detail?.events.filter((event) => ![
    'output.delta',
    'tool.called',
    'tool.completed',
    'run.claimed',
  ].includes(event.type)).slice(-4).reverse() ?? [];
  const builderRuns = detail?.runs.filter((run) => run.triggerType === 'user' || run.triggerType === 'retry') ?? [];
  const reviewerRuns = detail?.runs.filter((run) => run.triggerType === 'review') ?? [];
  const builderDone = builderRuns.some((run) => run.status === 'succeeded');
  const reviewDone = Boolean(latestReview) || reviewerRuns.some((run) => run.status === 'succeeded');
  const taskDone = detail?.task.status === 'completed';
  const completionLabel = detail?.task.completionPolicy === 'require_user_confirmation' ? '用户确认' : '自动完成';
  return (
    <section className="workspace">
      <header className="workspace-header">
        <div className="workspace-title">
          <p>任务 / {detail?.task.id.slice(0, 8) ?? '未选择'}</p>
          <div>
            <h1>{detail?.task.title ?? '选择一个任务'}</h1>
            {detail ? <span className={`status-pill ${detail.task.status}`}>{statusLabels[detail.task.status]}</span> : null}
          </div>
        </div>
        <div className="workspace-actions">
          <button className="secondary-button" onClick={onConfigureAgents} type="button">Agent 配置</button>
          <button className="new-task-button" onClick={onNewTask} type="button">新建任务</button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      {detail ? (
        <>
          <section className="run-overview" aria-label="当前执行信息">
            <div><span>Agent</span><strong>{currentAgent?.name ?? detail.task.agentId}</strong></div>
            <div><span>Run</span><code>{currentRun?.id.slice(0, 8) ?? '—'}</code></div>
            <div><span>版本</span><strong>v{detail.task.version}</strong></div>
            <div className="run-state"><span>状态</span><strong>{currentRun?.status ?? '等待中'}</strong></div>
            {canCancel ? <button className="cancel-button" onClick={onCancel} type="button">取消 Run</button> : null}
            {canConfirm ? (
              <button className="confirm-button" disabled={confirming} onClick={onConfirm} type="button">
                {confirming ? '确认中…' : '确认完成'}
              </button>
            ) : null}
          </section>

          <div className="workspace-tabs" role="tablist" aria-label="任务详情视图">
            <button
              aria-selected={workspaceView === 'overview'}
              className={workspaceView === 'overview' ? 'active' : ''}
              onClick={() => setWorkspaceView('overview')}
              role="tab"
              type="button"
            >
              任务概览
            </button>
            <button
              aria-selected={workspaceView === 'activity'}
              className={workspaceView === 'activity' ? 'active' : ''}
              onClick={() => setWorkspaceView('activity')}
              role="tab"
              type="button"
            >
              运行日志 <span>{detail.events.length}</span>
            </button>
          </div>

          <section className="workspace-panel" role="tabpanel">
            {workspaceView === 'overview' ? (
              <div className="overview-grid">
                <article className="overview-card task-brief-card">
                  <header>
                    <div><span>任务目标</span><h2>这次需要完成什么</h2></div>
                  </header>
                  <p>{detail.task.description}</p>
                  <div className="acceptance-block">
                    <span>验收标准</span>
                    {detail.task.acceptanceCriteria.length > 0 ? (
                      <ul>{detail.task.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>
                    ) : <p>未设置单独的验收标准。</p>}
                  </div>
                </article>

                <article className="overview-card workflow-card">
                  <header>
                    <div><span>协作流程</span><h2>当前走到哪一步</h2></div>
                  </header>
                  <ol className="workflow-steps">
                    <li data-state={builderDone ? 'done' : 'current'}>
                      <i>{builderDone ? '✓' : '1'}</i><div><strong>Builder</strong><span>{builderRuns.length} 个 Run</span></div>
                    </li>
                    <li data-state={reviewDone ? 'done' : builderDone ? 'current' : 'pending'}>
                      <i>{reviewDone ? '✓' : '2'}</i><div><strong>Reviewer</strong><span>{reviewerRuns.length} 个 Run</span></div>
                    </li>
                    <li data-state={taskDone ? 'done' : reviewDone ? 'current' : 'pending'}>
                      <i>{taskDone ? '✓' : '3'}</i><div><strong>{completionLabel}</strong><span>{statusLabels[detail.task.status]}</span></div>
                    </li>
                  </ol>
                </article>

                <article className="overview-card result-card">
                  <header>
                    <div><span>{latestReview ? `Review #${latestReview.round}` : '当前结果'}</span><h2>{latestReview ? '最近审查结论' : '最近执行进展'}</h2></div>
                    {latestReview ? <strong className={`review-verdict ${latestReview.verdict}`}>{latestReview.verdict.replace('_', ' ')}</strong> : null}
                  </header>
                  <p>{latestReview?.summary ?? currentRun?.outcome?.summary ?? 'Agent 正在准备结果，关键进展会显示在这里。'}</p>
                  {latestReview ? <small>{latestReview.findings.length} 个 finding</small> : null}
                </article>

                <article className="overview-card milestone-card">
                  <header>
                    <div><span>关键节点</span><h2>最近发生了什么</h2></div>
                    <button onClick={() => setWorkspaceView('activity')} type="button">查看全部日志</button>
                  </header>
                  <ol>
                    {milestoneEvents.map((event) => (
                      <li key={event.id}>
                        <i data-tone={eventTone(event)} />
                        <div><strong>{eventLabels[event.type] ?? event.type}</strong><span>{eventText(event)}</span></div>
                        <time>{new Date(event.occurredAt).toLocaleTimeString('zh-CN')}</time>
                      </li>
                    ))}
                  </ol>
                </article>

                {currentRun?.worktreePath ? (
                  <article className="overview-card worktree-card">
                    <header><div><span>隔离工作区</span><h2>本次 Run 的代码环境</h2></div></header>
                    <dl>
                      <div><dt>分支</dt><dd><code>{currentRun.branchName}</code></dd></div>
                      <div><dt>目录</dt><dd><code title={currentRun.workingDirectory}>{currentRun.workingDirectory}</code></dd></div>
                    </dl>
                  </article>
                ) : null}
              </div>
            ) : (
              <section className="timeline-surface">
                <header className="timeline-heading">
                  <div>
                    <h2>完整运行日志</h2>
                    <p>Agent 输出、工具调用和平台状态都在这里，便于排查和审计</p>
                  </div>
                  <span>{detail.events.length} events</span>
                </header>
                <ol className="timeline">
                  {detail.events.map((event, index) => (
                    <li data-tone={eventTone(event)} key={event.id}>
                      <span className="event-marker">{String(index + 1).padStart(2, '0')}</span>
                      <div className="event-body">
                        <div className="event-meta">
                          <div>
                            <strong>{eventLabels[event.type] ?? event.type}</strong>
                            <code>{event.type}</code>
                          </div>
                          <time>{new Date(event.occurredAt).toLocaleTimeString('zh-CN')}</time>
                        </div>
                        <p>{eventText(event)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </section>
        </>
      ) : (
        <div className="timeline-placeholder">
          <span>R</span>
          <h2>还没有选中任务</h2>
          <p>从左侧选择任务，或创建一个新的 Agent Run。</p>
        </div>
      )}
    </section>
  );
}

interface CreateTaskDrawerProps {
  open: boolean;
  title: string;
  description: string;
  criterion: string;
  completionPolicy: CompletionPolicy;
  maxReviewRounds: number;
  workspaceRoot: string;
  agents: AgentProfile[];
  reviewerAgents: AgentProfile[];
  selectedAgentId: string;
  selectedAgent: AgentProfile | null;
  selectedReviewerAgentId: string;
  selectedReviewer: AgentProfile | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCriterionChange: (value: string) => void;
  onCompletionPolicyChange: (value: CompletionPolicy) => void;
  onMaxReviewRoundsChange: (value: number) => void;
  onWorkspaceRootChange: (value: string) => void;
  onAgentChange: (value: string) => void;
  onReviewerChange: (value: string) => void;
}

export function CreateTaskDrawer({
  open,
  title,
  description,
  criterion,
  completionPolicy,
  maxReviewRounds,
  workspaceRoot,
  agents,
  reviewerAgents,
  selectedAgentId,
  selectedAgent,
  selectedReviewerAgentId,
  selectedReviewer,
  submitting,
  onClose,
  onSubmit,
  onTitleChange,
  onDescriptionChange,
  onCriterionChange,
  onCompletionPolicyChange,
  onMaxReviewRoundsChange,
  onWorkspaceRootChange,
  onAgentChange,
  onReviewerChange,
}: CreateTaskDrawerProps) {
  return (
    <>
      {open ? <button aria-label="关闭新建任务" className="drawer-backdrop" onClick={onClose} type="button" /> : null}
      <aside aria-hidden={!open} className={`create-drawer ${open ? 'open' : ''}`}>
        <header className="drawer-header">
          <div>
            <p>New task</p>
            <h2>创建 Agent 任务</h2>
          </div>
          <button aria-label="关闭" className="drawer-close" onClick={onClose} type="button">×</button>
        </header>
        <form onSubmit={onSubmit}>
          <label>
            任务标题
            <input minLength={3} onChange={(event) => onTitleChange(event.target.value)} required value={title} />
          </label>
          <label>
            需求描述
            <textarea onChange={(event) => onDescriptionChange(event.target.value)} required rows={3} value={description} />
          </label>
          <label>
            验收标准
            <textarea onChange={(event) => onCriterionChange(event.target.value)} rows={2} value={criterion} />
          </label>
          <label>
            Git Workspace 路径
            <input onChange={(event) => onWorkspaceRootChange(event.target.value)} required value={workspaceRoot} />
          </label>
          <div className="policy-grid">
            <label>
              审查通过后
              <select
                onChange={(event) => onCompletionPolicyChange(event.target.value as CompletionPolicy)}
                value={completionPolicy}
              >
                <option value="require_user_confirmation">等待用户最终确认</option>
                <option value="auto_on_approval">自动完成任务</option>
                <option value="risk_based">按验证证据判断</option>
              </select>
            </label>
            <label>
              最大 Review 轮数
              <input
                max={10}
                min={1}
                onChange={(event) => onMaxReviewRoundsChange(Number(event.target.value))}
                type="number"
                value={maxReviewRounds}
              />
            </label>
          </div>
          <div className="agent-flow-grid" aria-label="Agent 工作流">
            <div className="agent-flow-step">
              <label>
                Builder
                <select onChange={(event) => onAgentChange(event.target.value)} value={selectedAgentId}>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </label>
              <div className="agent-choice">
                <span className="agent-mark">
                  {selectedAgent?.adapterType === 'codex_cli' ? 'C' : selectedAgent?.adapterType === 'opencode_cli' ? 'O' : 'M'}
                </span>
                <div>
                  <strong>{selectedAgent?.name ?? '正在加载'}</strong>
                  <small>
                    {selectedAgent?.adapterType === 'opencode_cli'
                      ? `${selectedAgent.modelLabel ?? 'OpenCode'} · 隔离执行`
                      : selectedAgent?.adapterType === 'codex_cli'
                        ? '真实 CLI · 隔离执行'
                        : '实现任务 · 生成交接'}
                  </small>
                </div>
              </div>
            </div>
            <div className="agent-flow-step">
              <label>
                Reviewer
                <select
                  disabled={reviewerAgents.length === 0}
                  onChange={(event) => onReviewerChange(event.target.value)}
                  value={selectedReviewerAgentId}
                >
                  {reviewerAgents.length === 0 ? <option value="">暂不启用</option> : null}
                  {reviewerAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </label>
              <div className="agent-choice">
                <span className="agent-mark">R</span>
                <div>
                  <strong>{selectedReviewer?.name ?? '尚未配置'}</strong>
                  <small>独立 Run · 只读审查</small>
                </div>
              </div>
            </div>
          </div>
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? '正在创建…' : '启动任务'}
          </button>
        </form>
      </aside>
    </>
  );
}

interface AgentConfigDrawerProps {
  open: boolean;
  name: string;
  capabilities: AgentCapability[];
  adapterType: AgentAdapterType;
  model: string;
  variant: string;
  agentName: string;
  credentialEnv: string;
  runtimes: AgentRuntimeDescriptor[];
  saving: boolean;
  health: AgentHealth | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAdapterChange: (value: AgentAdapterType) => void;
  onAgentNameChange: (value: string) => void;
  onCapabilitiesChange: (value: AgentCapability[]) => void;
  onNameChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onVariantChange: (value: string) => void;
  onCredentialEnvChange: (value: string) => void;
}

export function AgentConfigDrawer({
  open,
  name,
  capabilities,
  adapterType,
  model,
  variant,
  agentName,
  credentialEnv,
  runtimes,
  saving,
  health,
  onClose,
  onSubmit,
  onAdapterChange,
  onAgentNameChange,
  onCapabilitiesChange,
  onNameChange,
  onModelChange,
  onVariantChange,
  onCredentialEnvChange,
}: AgentConfigDrawerProps) {
  const selectedRuntime = runtimes.find((runtime) => runtime.adapterType === adapterType);
  const runtimeMark = adapterType === 'codex_cli' ? 'C' : adapterType === 'opencode_cli' ? 'O' : 'M';
  const runtimeLabel = selectedRuntime?.label ?? (
    adapterType === 'codex_cli' ? 'Codex CLI' : adapterType === 'opencode_cli' ? 'OpenCode CLI' : 'Mock'
  );
  const openCodeModels = runtimes.find((runtime) => runtime.adapterType === 'opencode_cli')?.models ?? [];
  return (
    <>
      {open ? <button aria-label="关闭 Agent 配置" className="drawer-backdrop" onClick={onClose} type="button" /> : null}
      <aside aria-hidden={!open} className={`create-drawer ${open ? 'open' : ''}`}>
        <header className="drawer-header">
          <div>
            <p>Agent profile</p>
            <h2>新建 Agent</h2>
          </div>
          <button aria-label="关闭" className="drawer-close" onClick={onClose} type="button">×</button>
        </header>
        <form onSubmit={onSubmit}>
          <div className="runtime-card">
            <span className="agent-mark">{runtimeMark}</span>
            <div>
              <strong>{runtimeLabel}{selectedRuntime?.version ? ` · ${selectedRuntime.version}` : ''}</strong>
              <small>{selectedRuntime?.message ?? '正在检测本机 CLI…'}</small>
            </div>
          </div>
          <label>
            Agent 名称
            <input minLength={2} onChange={(event) => onNameChange(event.target.value)} required value={name} />
          </label>
          <label>
            运行 CLI
            <select onChange={(event) => onAdapterChange(event.target.value as AgentAdapterType)} value={adapterType}>
              <option value="mock">Mock · 内置确定性运行时</option>
              <option value="codex_cli">Codex CLI</option>
              <option value="opencode_cli">OpenCode CLI</option>
            </select>
          </label>
          <fieldset className="capability-fieldset">
            <legend>能力（至少选择一项）</legend>
            <div className="capability-grid">
              {([
                ['implement', 'Builder', '实现与修改代码'],
                ['review', 'Reviewer', '独立只读审查'],
              ] as const).map(([capability, label, description]) => (
                <label className="capability-option" key={capability}>
                  <input
                    checked={capabilities.includes(capability)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...capabilities, capability]
                        : capabilities.filter((candidate) => candidate !== capability);
                      if (next.length > 0) onCapabilitiesChange(next);
                    }}
                    type="checkbox"
                  />
                  <span><strong>{label}</strong><small>{description}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
          {adapterType === 'opencode_cli' ? <>
            <label>
              模型（provider/model）
              <input
                list="opencode-models"
                onChange={(event) => onModelChange(event.target.value)}
                placeholder="例如 opencode/big-pickle"
                required
                value={model}
              />
              <datalist id="opencode-models">
                {openCodeModels.map((candidate) => <option key={candidate} value={candidate} />)}
              </datalist>
            </label>
            <div className="policy-grid">
              <label>
                Variant（可选）
                <input onChange={(event) => onVariantChange(event.target.value)} placeholder="high / max" value={variant} />
              </label>
              <label>
                OpenCode 内部 Agent（可选）
                <input onChange={(event) => onAgentNameChange(event.target.value)} placeholder="build" value={agentName} />
              </label>
            </div>
            <label>
              密钥环境变量（可选）
              <input
                onChange={(event) => onCredentialEnvChange(event.target.value.toUpperCase())}
                placeholder="OPENAI_API_KEY"
                value={credentialEnv}
              />
            </label>
          </> : null}
          <div className="config-note">
            {adapterType === 'opencode_cli' ? <>
              Agent 是 RelayHub 身份，OpenCode 只是运行 CLI。这里只保存环境变量名称，不保存密钥值；也可以使用 <code>opencode providers login</code>。
            </> : adapterType === 'codex_cli' ? <>
              Agent 将使用本机 Codex CLI 的当前登录与默认模型配置，CLI 只是运行载体。
            </> : <>
              Mock 不调用外部模型，用于稳定演示完整编排链路。
            </>}
          </div>
          {health ? (
            <div className={`health-result ${health.status}`}>
              <strong>{health.status === 'healthy' ? '运行时可用' : '配置需要处理'}</strong>
              <span>{health.message}</span>
            </div>
          ) : null}
          <button
            className="primary-button"
            disabled={saving || name.trim().length < 2 || (adapterType === 'opencode_cli' && !model)}
            type="submit"
          >
            {saving ? '保存并检测中…' : '保存 Agent'}
          </button>
        </form>
      </aside>
    </>
  );
}
