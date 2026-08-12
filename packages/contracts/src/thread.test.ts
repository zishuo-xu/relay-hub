import { describe, expect, it } from 'vitest';
import {
  ConversationContextViewSchema,
  CreateThreadInputSchema,
  CreateThreadMessageInputSchema,
  DEFAULT_MOCK_AGENT_ID,
} from './index.js';

describe('conversation thread contracts', () => {
  it('provides a compact default title and completion policy', () => {
    expect(CreateThreadInputSchema.parse({})).toEqual({ title: '新协作线程' });
    expect(CreateThreadMessageInputSchema.parse({ content: '请分析当前架构', agentIds: [DEFAULT_MOCK_AGENT_ID] })).toEqual({
      content: '请分析当前架构',
      agentIds: [DEFAULT_MOCK_AGENT_ID],
      completionPolicy: 'require_user_confirmation',
      maxReviewRounds: 3,
    });
  });

  it('rejects empty messages before a Run can be created', () => {
    expect(() => CreateThreadMessageInputSchema.parse({ content: '   ', agentIds: [DEFAULT_MOCK_AGENT_ID] })).toThrow();
    expect(() => CreateThreadMessageInputSchema.parse({ content: 'x', agentIds: [] })).toThrow();
    expect(() => CreateThreadMessageInputSchema.parse({
      content: 'x',
      agentIds: [DEFAULT_MOCK_AGENT_ID, DEFAULT_MOCK_AGENT_ID],
    })).toThrow('Agent targets must be unique');
  });

  it('validates the internal public ConversationContext envelope strictly', () => {
    const context = {
      threadId: '00000000-0000-4000-8000-000000000100',
      policyVersion: 1,
      beforeSequence: 2,
      messages: [{
        id: '00000000-0000-4000-8000-000000000101',
        sequence: 1,
        senderType: 'user',
        senderName: '你',
        content: '先分析架构。',
        createdAt: new Date(0).toISOString(),
      }],
      omittedMessageCount: 0,
      truncatedMessageIds: [],
      digest: 'a'.repeat(64),
    };
    expect(ConversationContextViewSchema.parse(context)).toEqual(context);
    expect(() => ConversationContextViewSchema.parse({ ...context, hiddenReasoning: 'never allowed' })).toThrow();
  });
});
