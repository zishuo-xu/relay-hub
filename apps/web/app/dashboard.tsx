'use client';

import type { AgentProfile, RunEvent, Task, TaskDetail } from '@relay-hub/contracts';
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
  'run.started': 'Agent 已启动',
  'output.delta': 'Agent 输出',
  'tool.called': '工具调用',
  'tool.completed': '工具完成',
  'run.completed': '执行结束',
  'task.waiting_for_review': '等待审查',
  'task.review_requested': '进入审查',
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
    case 'task.waiting_for_review':
      return 'Builder 已完成执行；Reviewer 工作流尚未启用，等待用户检查。';
    case 'task.review_requested':
      return 'Builder 结果已进入独立 Reviewer 审查。';
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

function eventTone(event: RunEvent): string {
  if (event.type === 'run.failed' || event.type === 'run.cancelled') return 'danger';
  if (event.type === 'run.completed') return 'success';
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
        <span>Phase 2</span>
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
  error: string | null;
  onCancel: () => void;
  onNewTask: () => void;
}

export function TimelineWorkspace({
  detail,
  currentRun,
  currentAgent,
  canCancel,
  error,
  onCancel,
  onNewTask,
}: TimelineWorkspaceProps) {
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
          <span className="runtime-label"><i />Codex Runtime</span>
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
          </section>

          {currentRun?.worktreePath ? (
            <div className="worktree-strip">
              <span>隔离工作区</span>
              <code>{currentRun.branchName}</code>
              <code title={currentRun.workingDirectory}>{currentRun.workingDirectory}</code>
            </div>
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
  workspaceRoot: string;
  agents: AgentProfile[];
  selectedAgentId: string;
  selectedAgent: AgentProfile | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCriterionChange: (value: string) => void;
  onWorkspaceRootChange: (value: string) => void;
  onAgentChange: (value: string) => void;
}

export function CreateTaskDrawer({
  open,
  title,
  description,
  criterion,
  workspaceRoot,
  agents,
  selectedAgentId,
  selectedAgent,
  submitting,
  onClose,
  onSubmit,
  onTitleChange,
  onDescriptionChange,
  onCriterionChange,
  onWorkspaceRootChange,
  onAgentChange,
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
            <textarea onChange={(event) => onDescriptionChange(event.target.value)} required rows={4} value={description} />
          </label>
          <label>
            验收标准
            <textarea onChange={(event) => onCriterionChange(event.target.value)} rows={3} value={criterion} />
          </label>
          <label>
            Git Workspace 路径
            <input onChange={(event) => onWorkspaceRootChange(event.target.value)} required value={workspaceRoot} />
          </label>
          <label>
            执行 Agent
            <select onChange={(event) => onAgentChange(event.target.value)} value={selectedAgentId}>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
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
    </>
  );
}
