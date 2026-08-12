import { describe, expect, it } from 'vitest';
import { selectConversationContextV1 } from './conversation-context.js';

function message(sequence: number, content = `message-${sequence}`) {
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    sequence,
    senderType: sequence % 2 === 0 ? 'agent' as const : 'user' as const,
    senderName: sequence % 2 === 0 ? 'Agent A' : '你',
    content,
    createdAt: new Date(sequence * 1_000).toISOString(),
  };
}

describe('selectConversationContextV1', () => {
  it('keeps the newest public messages before the Task boundary in chronological order', () => {
    const context = selectConversationContextV1({
      threadId: '00000000-0000-4000-8000-000000000100',
      beforeSequence: 25,
      messages: Array.from({ length: 25 }, (_, index) => message(index + 1)),
    });

    expect(context.messages).toHaveLength(20);
    expect(context.messages[0]?.sequence).toBe(5);
    expect(context.messages.at(-1)?.sequence).toBe(24);
    expect(context.omittedMessageCount).toBe(4);
    expect(context.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies deterministic per-message and total character budgets', () => {
    const context = selectConversationContextV1({
      threadId: '00000000-0000-4000-8000-000000000100',
      beforeSequence: 9,
      messages: Array.from({ length: 8 }, (_, index) => message(index + 1, 'x'.repeat(2_000))),
    });

    expect(context.messages.reduce((total, item) => total + item.content.length, 0)).toBeLessThanOrEqual(8_000);
    expect(context.messages.at(-1)?.content).toContain('内容已截断');
    expect(context.truncatedMessageIds.length).toBe(context.messages.length);
    expect(context.omittedMessageCount).toBeGreaterThan(0);
    expect(selectConversationContextV1({
      threadId: context.threadId,
      beforeSequence: 9,
      messages: Array.from({ length: 8 }, (_, index) => message(index + 1, 'x'.repeat(2_000))),
    }).digest).toBe(context.digest);
  });

  it('rejects duplicate sequence values instead of producing ambiguous history', () => {
    expect(() => selectConversationContextV1({
      threadId: '00000000-0000-4000-8000-000000000100',
      beforeSequence: 3,
      messages: [message(1), { ...message(2), sequence: 1 }],
    })).toThrow('Duplicate conversation message sequence');
  });
});
