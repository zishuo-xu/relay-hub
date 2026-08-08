'use client';

import type { AgentHealth, AgentProfile, CompletionPolicy, RunEvent, Task, TaskDetail } from '@relay-hub/contracts';
import type { FormEvent } from 'react';

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
  const activeCount = tasks.filter((task) => ['queued', 'running', 'reviewing'].includes(task.status)).length;
  const completedCount = tasks.filter((task) => task.status === 'completed').length;

  return (
    <aside className="task-sidebar">
      <header className="product-header">
        <strong>RelayHub</strong>
        <span>Agent workspace</span>
      </header>
      <div className="sidebar-heading">
        <div>
          <p>任务</p>
          <span>{tasks.length} 个任务</span>
        </div>
        <span className="task-total">{tasks.length}</span>
      </div>
      <div className="task-summary" aria-label="任务概览">
        <span><i className="summary-dot active" />{activeCount} 进行中</span>
        <span><i className="summary-dot completed" />{completedCount} 已完成</span>
      </div>
      <div className="task-list">
        {tasks.length === 0 ? <p className="empty">创建第一个任务，观察完整执行链。</p> : null}
        {tasks.map((task) => (
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
  currentAgent: AgentProfile | null;
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
  const latestReview = detail?.reviews.at(-1);
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
          <span className="runtime-label"><i />Agent Runtime</span>
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

          {currentRun?.worktreePath ? (
            <div className="worktree-strip">
              <span>隔离工作区</span>
              <code>{currentRun.branchName}</code>
              <code title={currentRun.workingDirectory}>{currentRun.workingDirectory}</code>
            </div>
          ) : null}

          {latestReview ? (
            <section className="review-strip" data-verdict={latestReview.verdict} aria-label="最新审查结论">
              <div>
                <span>Review #{latestReview.round}</span>
                <strong>{latestReview.verdict.replace('_', ' ')}</strong>
              </div>
              <p>{latestReview.summary}</p>
              <span>{latestReview.findings.length} findings</span>
            </section>
          ) : null}

          <section className="timeline-surface">
            <header className="timeline-heading">
              <div>
                <h2>执行记录</h2>
                <p>已持久化的 Agent 与平台事件</p>
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
  role: 'implement' | 'review';
  model: string;
  variant: string;
  agentName: string;
  credentialEnv: string;
  version: string;
  models: string[];
  saving: boolean;
  health: AgentHealth | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAgentNameChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onRoleChange: (value: 'implement' | 'review') => void;
  onModelChange: (value: string) => void;
  onVariantChange: (value: string) => void;
  onCredentialEnvChange: (value: string) => void;
}

export function AgentConfigDrawer({
  open,
  name,
  role,
  model,
  variant,
  agentName,
  credentialEnv,
  version,
  models,
  saving,
  health,
  onClose,
  onSubmit,
  onAgentNameChange,
  onNameChange,
  onRoleChange,
  onModelChange,
  onVariantChange,
  onCredentialEnvChange,
}: AgentConfigDrawerProps) {
  return (
    <>
      {open ? <button aria-label="关闭 Agent 配置" className="drawer-backdrop" onClick={onClose} type="button" /> : null}
      <aside aria-hidden={!open} className={`create-drawer ${open ? 'open' : ''}`}>
        <header className="drawer-header">
          <div>
            <p>Agent profile</p>
            <h2>配置 OpenCode</h2>
          </div>
          <button aria-label="关闭" className="drawer-close" onClick={onClose} type="button">×</button>
        </header>
        <form onSubmit={onSubmit}>
          <div className="runtime-card">
            <span className="agent-mark">O</span>
            <div>
              <strong>OpenCode CLI {version || '检测中…'}</strong>
              <small>{models.length} 个当前项目可见模型</small>
            </div>
          </div>
          <label>
            Agent 名称
            <input minLength={2} onChange={(event) => onNameChange(event.target.value)} required value={name} />
          </label>
          <label>
            角色
            <select onChange={(event) => onRoleChange(event.target.value as 'implement' | 'review')} value={role}>
              <option value="implement">Builder · 可修改代码</option>
              <option value="review">Reviewer · 强制只读</option>
            </select>
          </label>
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
              {models.map((candidate) => <option key={candidate} value={candidate} />)}
            </datalist>
          </label>
          <div className="policy-grid">
            <label>
              Variant（可选）
              <input onChange={(event) => onVariantChange(event.target.value)} placeholder="high / max" value={variant} />
            </label>
            <label>
              OpenCode Agent（可选）
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
          <div className="config-note">
            RelayHub 只保存环境变量名称，不保存密钥值。也可以先执行 <code>opencode providers login</code> 使用 OpenCode 自己的凭证。健康检测只确认 CLI 与模型目录，真实凭证会在任务执行时验证。
          </div>
          {health ? (
            <div className={`health-result ${health.status}`}>
              <strong>{health.status === 'healthy' ? 'CLI 与模型可见' : '配置需要处理'}</strong>
              <span>{health.message}</span>
            </div>
          ) : null}
          <button className="primary-button" disabled={saving || !model} type="submit">
            {saving ? '保存并检测中…' : '保存 OpenCode Agent'}
          </button>
        </form>
      </aside>
    </>
  );
}
