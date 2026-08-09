import { createHash } from 'node:crypto';
import type { HandoffArtifactRef, NextAction } from '@relay-hub/contracts';

export interface HandoffIntegrityInput {
  bundleVersion: number;
  sourceRunId: string;
  targetAgentId: string;
  objective: string;
  contextSummary: string;
  artifactRefs: HandoffArtifactRef[];
  evidenceRefs: HandoffArtifactRef[];
  acceptanceCriteria: string[];
  decisions: string[];
  openQuestions: string[];
  risks: string[];
  nextAction: NextAction;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function handoffContentDigest(input: HandoffIntegrityInput): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}
