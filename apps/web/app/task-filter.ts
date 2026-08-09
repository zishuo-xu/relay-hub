import type { Task } from '@relay-hub/contracts';

export type TaskFilter = 'focus' | 'all';

const focusStatuses = new Set<Task['status']>([
  'draft',
  'queued',
  'running',
  'reviewing',
  'changes_requested',
  'waiting_for_user',
  'failed',
]);

export function isFocusTask(task: Task): boolean {
  return focusStatuses.has(task.status);
}

export function resolveTaskFilter(
  filter: TaskFilter,
  tasks: Task[],
  selectedTaskId: string | null,
): TaskFilter {
  if (filter === 'all' || !selectedTaskId) return filter;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  return selectedTask && !isFocusTask(selectedTask) ? 'all' : filter;
}

export function visibleTasksForFilter(tasks: Task[], filter: TaskFilter): Task[] {
  return filter === 'all' ? tasks : tasks.filter(isFocusTask);
}

export function selectedTaskIdForFocusFilter(tasks: Task[], selectedTaskId: string | null): string | null {
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  if (selectedTask && isFocusTask(selectedTask)) return selectedTask.id;
  return tasks.find(isFocusTask)?.id ?? null;
}
