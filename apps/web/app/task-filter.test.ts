import type { Task } from '@relay-hub/contracts';
import { describe, expect, it } from 'vitest';
import {
  isFocusTask,
  resolveTaskFilter,
  selectedTaskIdForFocusFilter,
  visibleTasksForFilter,
} from './task-filter';

function task(id: string, status: Task['status']): Task {
  return {
    id,
    workspaceId: 'workspace-1',
    title: id,
    description: id,
    agentId: 'agent-1',
    acceptanceCriteria: [],
    status,
    completionPolicy: 'require_user_confirmation',
    maxReviewRounds: 3,
    currentRunId: `run-${id}`,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    version: 1,
  };
}

describe('task filtering', () => {
  const tasks = [task('active', 'waiting_for_user'), task('done', 'completed')];

  it('counts only tasks that need attention', () => {
    expect(tasks.filter(isFocusTask).map((candidate) => candidate.id)).toEqual(['active']);
  });

  it('switches to all when the selected task becomes terminal', () => {
    expect(resolveTaskFilter('focus', tasks, 'done')).toBe('all');
    expect(visibleTasksForFilter(tasks, 'all')).toHaveLength(2);
  });

  it('keeps focus when the selected task still needs attention', () => {
    expect(resolveTaskFilter('focus', tasks, 'active')).toBe('focus');
    expect(visibleTasksForFilter(tasks, 'focus')).toEqual([tasks[0]]);
  });

  it('selects the first focus task when the user leaves a terminal task', () => {
    expect(selectedTaskIdForFocusFilter(tasks, 'done')).toBe('active');
    expect(selectedTaskIdForFocusFilter(tasks, 'active')).toBe('active');
  });
});
