import { createHash } from 'node:crypto';
import {
  CONVERSATION_CONTEXT_POLICY_V1,
  ConversationContextMessageSchema,
  type ConversationContextMessage,
  type ConversationContextView,
} from '@relay-hub/contracts';

const TRUNCATION_MARKER = '\n[…内容已截断…]\n';

function truncateHeadTail(content: string, limit: number): string {
  if (content.length <= limit) return content;
  if (limit <= TRUNCATION_MARKER.length) return content.slice(0, limit);
  const available = limit - TRUNCATION_MARKER.length;
  const headLength = Math.floor(available * 0.4);
  return `${content.slice(0, headLength)}${TRUNCATION_MARKER}${content.slice(-(available - headLength))}`;
}

function digestContext(value: Omit<ConversationContextView, 'digest'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function selectConversationContextV1(input: {
  threadId: string;
  beforeSequence: number;
  messages: ConversationContextMessage[];
  totalEligibleMessageCount?: number;
}): ConversationContextView {
  const sorted = input.messages
    .map((message) => ConversationContextMessageSchema.parse(message))
    .filter((message) => message.sequence < input.beforeSequence)
    .sort((left, right) => left.sequence - right.sequence);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]?.sequence === sorted[index - 1]?.sequence) {
      throw new Error(`Duplicate conversation message sequence: ${sorted[index]?.sequence}`);
    }
  }

  const candidates = sorted.slice(-CONVERSATION_CONTEXT_POLICY_V1.maxMessages);
  const selectedNewestFirst: ConversationContextMessage[] = [];
  const truncatedMessageIds = new Set<string>();
  let remainingChars = CONVERSATION_CONTEXT_POLICY_V1.maxTotalContentChars;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index];
    if (!message || remainingChars <= 0) break;
    let content = truncateHeadTail(message.content, CONVERSATION_CONTEXT_POLICY_V1.maxContentCharsPerMessage);
    if (content !== message.content) truncatedMessageIds.add(message.id);
    if (content.length > remainingChars) {
      content = truncateHeadTail(content, remainingChars);
      truncatedMessageIds.add(message.id);
    }
    if (content.length === 0) break;
    selectedNewestFirst.push({ ...message, content });
    remainingChars -= content.length;
  }

  const messages = selectedNewestFirst.reverse();
  const totalEligibleMessageCount = input.totalEligibleMessageCount ?? sorted.length;
  if (totalEligibleMessageCount < sorted.length) {
    throw new Error('Conversation context total cannot be smaller than the supplied message set');
  }
  const withoutDigest = {
    threadId: input.threadId,
    policyVersion: 1 as const,
    beforeSequence: input.beforeSequence,
    messages,
    omittedMessageCount: totalEligibleMessageCount - messages.length,
    truncatedMessageIds: messages
      .filter((message) => truncatedMessageIds.has(message.id))
      .map((message) => message.id),
  };
  return { ...withoutDigest, digest: digestContext(withoutDigest) };
}
