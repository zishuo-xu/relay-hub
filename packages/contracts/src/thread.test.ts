import { describe, expect, it } from 'vitest';
import { CreateThreadInputSchema, CreateThreadMessageInputSchema, DEFAULT_MOCK_AGENT_ID } from './index.js';

describe('conversation thread contracts', () => {
  it('provides a compact default title and completion policy', () => {
    expect(CreateThreadInputSchema.parse({})).toEqual({ title: '新协作线程' });
    expect(CreateThreadMessageInputSchema.parse({ content: '请分析当前架构', agentId: DEFAULT_MOCK_AGENT_ID })).toEqual({
      content: '请分析当前架构',
      agentId: DEFAULT_MOCK_AGENT_ID,
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
  });

  it('rejects empty messages before a Run can be created', () => {
    expect(() => CreateThreadMessageInputSchema.parse({ content: '   ', agentId: DEFAULT_MOCK_AGENT_ID })).toThrow();
  });
});
