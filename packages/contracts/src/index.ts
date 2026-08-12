import { z } from 'zod';

export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_MOCK_AGENT_ID = '00000000-0000-4000-8000-000000000002';
export const DEFAULT_CODEX_AGENT_ID = '00000000-0000-4000-8000-000000000003';
export const DEFAULT_MOCK_REVIEWER_AGENT_ID = '00000000-0000-4000-8000-000000000004';
export const DEFAULT_CODEX_CONNECTION_ID = '00000000-0000-4000-8000-000000000005';
export const DEFAULT_OPENCODE_CONNECTION_ID = '00000000-0000-4000-8000-000000000006';
export const RUN_QUEUE_NAME = 'relay-hub-runs';

export const AGENT_RESULT_ENVELOPE_START = '<relayhub_result>';
export const AGENT_RESULT_ENVELOPE_END = '</relayhub_result>';
export const MAX_SEQUENTIAL_HANDOFFS = 6;
export const HANDOFF_REJECTION_REASONS = ['handoff_budget_exhausted', 'handoff_target_unavailable'] as const;
export type HandoffRejectionReason = (typeof HANDOFF_REJECTION_REASONS)[number];

export const AGENT_ADAPTER_TYPES = ['mock', 'codex_cli', 'opencode_cli'] as const;
export type AgentAdapterType = (typeof AGENT_ADAPTER_TYPES)[number];

export const AGENT_CAPABILITIES = ['implement', 'review'] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const AGENT_PERMISSION_PRESETS = ['builder_standard', 'reviewer_standard', 'analysis_read_only'] as const;
export type AgentPermissionPreset = (typeof AGENT_PERMISSION_PRESETS)[number];

export const ExecutionPolicySchema = z.object({
  fileAccess: z.enum(['read_only', 'workspace_write']),
  commandAccess: z.enum(['deny', 'allow']),
  networkAccess: z.enum(['none', 'loopback', 'outbound']),
  externalDirectoryAccess: z.literal('deny'),
  gitAccess: z.literal('none'),
  internalSubagents: z.enum(['deny', 'allow']),
}).strict();

export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;

export function executionPolicyPreset(
  adapterType: AgentAdapterType,
  preset: AgentPermissionPreset,
): ExecutionPolicy {
  if (preset === 'builder_standard') {
    return {
      fileAccess: 'workspace_write',
      commandAccess: 'allow',
      networkAccess: adapterType === 'opencode_cli' ? 'outbound' : adapterType === 'codex_cli' ? 'loopback' : 'none',
      externalDirectoryAccess: 'deny',
      gitAccess: 'none',
      internalSubagents: 'allow',
    };
  }
  if (preset === 'reviewer_standard') {
    return {
      fileAccess: 'read_only',
      commandAccess: adapterType === 'opencode_cli' ? 'deny' : 'allow',
      networkAccess: adapterType === 'opencode_cli' ? 'none' : adapterType === 'codex_cli' ? 'loopback' : 'none',
      externalDirectoryAccess: 'deny',
      gitAccess: 'none',
      internalSubagents: 'deny',
    };
  }
  return {
    fileAccess: 'read_only',
    commandAccess: adapterType === 'opencode_cli' ? 'deny' : 'allow',
    networkAccess: 'none',
    externalDirectoryAccess: 'deny',
    gitAccess: 'none',
    internalSubagents: 'deny',
  };
}

export function defaultExecutionPolicy(
  adapterType: AgentAdapterType,
  capabilities: readonly string[],
): ExecutionPolicy {
  return executionPolicyPreset(
    adapterType,
    capabilities.includes('implement') ? 'builder_standard' : 'reviewer_standard',
  );
}

export function identifyExecutionPolicyPreset(
  adapterType: AgentAdapterType,
  policy: ExecutionPolicy,
): AgentPermissionPreset | 'custom' {
  for (const preset of AGENT_PERMISSION_PRESETS) {
    const candidate = executionPolicyPreset(adapterType, preset);
    if (Object.entries(candidate).every(([key, value]) => policy[key as keyof ExecutionPolicy] === value)) return preset;
  }
  return 'custom';
}

export function effectiveExecutionPolicy(
  policy: ExecutionPolicy,
  triggerType: 'user' | 'handoff' | 'review' | 'retry',
): ExecutionPolicy {
  if (triggerType !== 'review') return policy;
  return {
    ...policy,
    fileAccess: 'read_only',
    networkAccess: policy.networkAccess === 'outbound' ? 'loopback' : policy.networkAccess,
    externalDirectoryAccess: 'deny',
    gitAccess: 'none',
  };
}

export function effectiveExecutionPolicyForAdapter(
  adapterType: AgentAdapterType,
  policy: ExecutionPolicy,
  triggerType: 'user' | 'handoff' | 'review' | 'retry',
): ExecutionPolicy {
  const effective = effectiveExecutionPolicy(policy, triggerType);
  if (adapterType === 'opencode_cli' && effective.fileAccess === 'read_only') {
    return { ...effective, commandAccess: 'deny', networkAccess: 'none' };
  }
  return effective;
}

export const PROVIDER_CONNECTION_KINDS = ['official_cli', 'custom_api'] as const;
export type ProviderConnectionKind = (typeof PROVIDER_CONNECTION_KINDS)[number];

export const PROVIDER_PROTOCOLS = ['cli_managed', 'openai_chat_completions', 'openai_responses'] as const;
export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number];

export const ProviderConnectionInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(PROVIDER_CONNECTION_KINDS),
    adapterType: z.enum(['codex_cli', 'opencode_cli']),
    protocol: z.enum(PROVIDER_PROTOCOLS),
    baseUrl: z.string().trim().url().max(2_048).refine((value) => /^https?:\/\//i.test(value), 'Base URI must use HTTP or HTTPS').optional(),
    credentialEnv: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,79}$/).optional(),
    models: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
    enabled: z.boolean().default(true),
  })
  .superRefine((input, context) => {
    if (new Set(input.models).size !== input.models.length) {
      context.addIssue({ code: 'custom', path: ['models'], message: 'Connection models must be unique' });
    }
    if (input.kind === 'official_cli') {
      if (input.protocol !== 'cli_managed') {
        context.addIssue({ code: 'custom', path: ['protocol'], message: 'Official CLI connections use cli_managed' });
      }
      if (input.baseUrl || input.credentialEnv) {
        context.addIssue({ code: 'custom', path: ['kind'], message: 'Official CLI authentication is managed by the CLI' });
      }
    } else {
      if (input.adapterType !== 'opencode_cli') {
        context.addIssue({ code: 'custom', path: ['adapterType'], message: 'Custom APIs currently require OpenCode CLI' });
      }
      if (input.protocol === 'cli_managed') {
        context.addIssue({ code: 'custom', path: ['protocol'], message: 'Custom APIs require an API protocol' });
      }
      if (!input.baseUrl) {
        context.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Custom APIs require a Base URI' });
      }
      if (input.models.length === 0) {
        context.addIssue({ code: 'custom', path: ['models'], message: 'Custom APIs require at least one model' });
      }
    }
  });

export type ProviderConnectionInput = z.infer<typeof ProviderConnectionInputSchema>;

export const ProviderConnectionHealthCheckInputSchema = z.object({
  mode: z.enum(['configuration', 'live']).default('configuration'),
  model: z.string().trim().min(1).max(240).optional(),
}).strict();

export type ProviderConnectionHealthCheckInput = z.infer<typeof ProviderConnectionHealthCheckInputSchema>;

export const ProviderConnectionSnapshotSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  kind: z.enum(PROVIDER_CONNECTION_KINDS),
  adapterType: z.enum(['codex_cli', 'opencode_cli']),
  protocol: z.enum(PROVIDER_PROTOCOLS),
  baseUrl: z.string().url().optional(),
  credentialEnv: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/).optional(),
  models: z.array(z.string()),
});

export type ProviderConnectionSnapshot = z.infer<typeof ProviderConnectionSnapshotSchema>;

export function openCodeProviderKey(connectionId: string): string {
  return `relayhub-${connectionId.replaceAll('-', '')}`;
}

export function openCodeProviderConfig(connection: ProviderConnectionSnapshot): Record<string, unknown> {
  if (connection.kind !== 'custom_api' || !connection.baseUrl) return {};
  return {
    provider: {
      [openCodeProviderKey(connection.id)]: {
        npm: connection.protocol === 'openai_responses' ? '@ai-sdk/openai' : '@ai-sdk/openai-compatible',
        name: connection.name,
        options: {
          baseURL: connection.baseUrl,
          ...(connection.credentialEnv ? { apiKey: `{env:${connection.credentialEnv}}` } : {}),
        },
        models: Object.fromEntries(connection.models.map((model) => [model, { name: model }])),
      },
    },
  };
}

export const AgentProfileInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    adapterType: z.enum(AGENT_ADAPTER_TYPES),
    capabilities: z.array(z.enum(AGENT_CAPABILITIES)).min(1).max(2),
    providerConnectionId: z.string().uuid().optional(),
    model: z.string().trim().min(3).max(240).optional(),
    variant: z.string().trim().min(1).max(80).optional(),
    agentName: z.string().trim().min(1).max(80).optional(),
    instructions: z.string().trim().max(8_000).default(''),
    executionPolicy: ExecutionPolicySchema.optional(),
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.adapterType !== 'mock' && !input.providerConnectionId) {
      context.addIssue({
        code: 'custom',
        path: ['providerConnectionId'],
        message: 'Executable Agents must reference a provider connection',
      });
    }
    if (input.adapterType !== 'opencode_cli' && (input.variant || input.agentName)) {
      context.addIssue({
        code: 'custom',
        path: ['adapterType'],
        message: 'Variant and internal Agent fields are only supported by OpenCode CLI',
      });
    }
    if (input.adapterType === 'mock' && input.model) {
      context.addIssue({ code: 'custom', path: ['model'], message: 'Mock Agents do not use a model' });
    }
    if (input.adapterType === 'mock' && input.providerConnectionId) {
      context.addIssue({ code: 'custom', path: ['providerConnectionId'], message: 'Mock Agents do not use a provider connection' });
    }
    if (new Set(input.capabilities).size !== input.capabilities.length) {
      context.addIssue({ code: 'custom', path: ['capabilities'], message: 'Agent capabilities must be unique' });
    }
    if (input.executionPolicy && input.adapterType === 'codex_cli') {
      if (input.executionPolicy.commandAccess === 'deny') {
        context.addIssue({
          code: 'custom',
          path: ['executionPolicy', 'commandAccess'],
          message: 'Codex CLI command denial is not enforceable by the current adapter',
        });
      }
      if (input.executionPolicy.networkAccess === 'outbound') {
        context.addIssue({
          code: 'custom',
          path: ['executionPolicy', 'networkAccess'],
          message: 'Codex CLI outbound network is not enabled by RelayHub',
        });
      }
    }
    if (input.executionPolicy && input.adapterType === 'opencode_cli') {
      if (input.executionPolicy.networkAccess === 'loopback') {
        context.addIssue({
          code: 'custom',
          path: ['executionPolicy', 'networkAccess'],
          message: 'OpenCode CLI cannot enforce loopback-only shell network access',
        });
      }
      if (input.executionPolicy.fileAccess === 'read_only' && input.executionPolicy.commandAccess === 'allow') {
        context.addIssue({
          code: 'custom',
          path: ['executionPolicy', 'commandAccess'],
          message: 'OpenCode read-only Agents must deny shell commands because shell writes cannot be sandboxed',
        });
      }
    }
  });

export type AgentProfileInput = z.input<typeof AgentProfileInputSchema>;

export const OpenCodeRuntimeConfigSchema = z.object({
  model: z.string().trim().min(1).max(240),
  variant: z.string().trim().min(1).max(80).optional(),
  agentName: z.string().trim().min(1).max(80).optional(),
  credentialEnv: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,79}$/).optional(),
  providerConnection: ProviderConnectionSnapshotSchema.optional(),
});

export type OpenCodeRuntimeConfig = z.infer<typeof OpenCodeRuntimeConfigSchema>;

export const TASK_STATUSES = [
  'draft',
  'queued',
  'running',
  'reviewing',
  'changes_requested',
  'waiting_for_user',
  'completed',
  'failed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RUN_STATUSES = [
  'queued',
  'claimed',
  'starting',
  'running',
  'succeeded',
  'failed',
  'cancelling',
  'cancelled',
  'lost',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const COMPLETION_POLICIES = [
  'auto_on_approval',
  'require_user_confirmation',
  'risk_based',
] as const;
export type CompletionPolicy = (typeof COMPLETION_POLICIES)[number];

export const REVIEW_VERDICTS = ['approved', 'changes_requested', 'blocked'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const FINDING_SEVERITIES = ['blocking', 'should_fix', 'suggestion'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const BootstrapStepSchema = z.object({
  name: z.string().trim().min(1).max(80),
  command: z.string().trim().min(1).max(1_000),
  args: z.array(z.string().max(2_000)).max(50).default([]),
  timeoutMs: z.number().int().min(1_000).max(10 * 60_000).default(120_000),
});

export const BootstrapPolicySchema = z.object({
  steps: z.array(BootstrapStepSchema).max(8).default([]),
});

export type BootstrapStep = z.infer<typeof BootstrapStepSchema>;
export type BootstrapPolicy = z.infer<typeof BootstrapPolicySchema>;

export const EMPTY_BOOTSTRAP_POLICY: BootstrapPolicy = { steps: [] };

const taskTransitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  draft: ['queued', 'cancelled'],
  queued: ['running', 'waiting_for_user', 'cancelled', 'failed'],
  running: ['reviewing', 'waiting_for_user', 'completed', 'failed', 'cancelled'],
  reviewing: ['changes_requested', 'waiting_for_user', 'completed', 'failed', 'cancelled'],
  changes_requested: ['queued', 'cancelled'],
  waiting_for_user: ['queued', 'completed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const runTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['claimed', 'cancelled'],
  claimed: ['starting', 'running', 'failed', 'cancelling', 'cancelled', 'lost'],
  starting: ['running', 'failed', 'cancelling', 'lost'],
  running: ['succeeded', 'failed', 'cancelling', 'lost'],
  succeeded: [],
  failed: [],
  cancelling: ['cancelled', 'failed', 'lost'],
  cancelled: [],
  lost: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return taskTransitions[from].includes(to);
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return runTransitions[from].includes(to);
}

export const CreateTaskInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(1).max(10_000),
  agentId: z.string().uuid().default(DEFAULT_MOCK_AGENT_ID),
  reviewerAgentId: z.string().uuid().optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  completionPolicy: z.enum(COMPLETION_POLICIES).default('require_user_confirmation'),
  maxReviewRounds: z.number().int().min(1).max(10).default(3),
});

export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const CreateThreadInputSchema = z.object({
  title: z.string().trim().min(1).max(120).default('新协作线程'),
});

export type CreateThreadInput = z.infer<typeof CreateThreadInputSchema>;

export const CreateThreadMessageInputSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
  agentIds: z.array(z.string().uuid()).min(1).max(4).refine(
    (agentIds) => new Set(agentIds).size === agentIds.length,
    'Agent targets must be unique',
  ),
  reviewerAgentId: z.string().uuid().optional(),
  completionPolicy: z.enum(COMPLETION_POLICIES).default('require_user_confirmation'),
  maxReviewRounds: z.number().int().min(1).max(10).default(3),
});

export type CreateThreadMessageInput = z.infer<typeof CreateThreadMessageInputSchema>;

export const CONVERSATION_CONTEXT_POLICY_V1 = {
  version: 1,
  maxMessages: 20,
  maxContentCharsPerMessage: 1_500,
  maxTotalContentChars: 8_000,
} as const;

export const ConversationContextMessageSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int().positive(),
  senderType: z.enum(['user', 'agent']),
  senderName: z.string().min(1),
  senderAgentId: z.string().uuid().optional(),
  recipientAgentId: z.string().uuid().optional(),
  content: z.string(),
  createdAt: z.string().datetime(),
}).strict();

export type ConversationContextMessage = z.infer<typeof ConversationContextMessageSchema>;

export const ConversationContextViewSchema = z.object({
  threadId: z.string().uuid(),
  policyVersion: z.literal(1),
  beforeSequence: z.number().int().positive(),
  messages: z.array(ConversationContextMessageSchema).max(CONVERSATION_CONTEXT_POLICY_V1.maxMessages),
  omittedMessageCount: z.number().int().nonnegative(),
  truncatedMessageIds: z.array(z.string().uuid()),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type ConversationContextView = z.infer<typeof ConversationContextViewSchema>;

export const CommandEvidenceSchema = z.object({
  command: z.string().min(1).max(4_000),
  status: z.enum(['succeeded', 'failed', 'unknown']),
  exitCode: z.number().int().optional(),
  outputSummary: z.string().max(2_000).optional(),
});

export type CommandEvidence = z.infer<typeof CommandEvidenceSchema>;

export const NextActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('continue'), reason: z.string().min(1).max(2_000) }).strict(),
  z.object({
    type: z.literal('handoff'),
    targetAgentId: z.string().uuid(),
    reason: z.string().min(1).max(2_000),
  }).strict(),
  z.object({
    type: z.literal('request_review'),
    targetAgentId: z.string().uuid(),
    reason: z.string().min(1).max(2_000),
  }).strict(),
  z.object({ type: z.literal('wait_for_user'), reason: z.string().min(1).max(2_000) }).strict(),
  z.object({ type: z.literal('complete'), reason: z.string().min(1).max(2_000) }).strict(),
]);

export type NextAction = z.infer<typeof NextActionSchema>;

export const RunOutcomeSchema = z.object({
  summary: z.string().min(1).max(10_000),
  publicMessage: z.string().min(1).max(10_000).optional(),
  commandEvidence: z.array(CommandEvidenceSchema).max(100).default([]),
  nextAction: NextActionSchema.optional(),
});

export type RunOutcome = z.infer<typeof RunOutcomeSchema>;

export const HandoffArtifactRefSchema = z.object({
  kind: z.enum(['worktree', 'file', 'url', 'text', 'command']),
  value: z.string().min(1).max(4_096),
  label: z.string().min(1).max(200).optional(),
});

export type HandoffArtifactRef = z.infer<typeof HandoffArtifactRefSchema>;

export const HandoffDraftSchema = z.object({
  bundleVersion: z.literal(2).default(2),
  targetAgentId: z.string().uuid(),
  objective: z.string().min(1).max(2_000),
  summary: z.string().min(1).max(10_000),
  artifactRefs: z.array(HandoffArtifactRefSchema).max(100).default([]),
  evidenceRefs: z.array(HandoffArtifactRefSchema).max(100).default([]),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).max(20).default([]),
  decisions: z.array(z.string().min(1).max(2_000)).max(50).default([]),
  openQuestions: z.array(z.string().min(1).max(2_000)).max(50).default([]),
  risks: z.array(z.string().min(1).max(2_000)).max(50).default([]),
  nextAction: NextActionSchema,
}).superRefine((handoff, context) => {
  if (handoff.nextAction.type !== 'handoff' && handoff.nextAction.type !== 'request_review') {
    context.addIssue({
      code: 'custom',
      path: ['nextAction', 'type'],
      message: 'a Handoff nextAction must be handoff or request_review',
    });
    return;
  }
  if (handoff.nextAction.targetAgentId !== handoff.targetAgentId) {
    context.addIssue({
      code: 'custom',
      path: ['nextAction', 'targetAgentId'],
      message: 'nextAction targetAgentId must match the Handoff targetAgentId',
    });
  }
});

export type HandoffDraft = z.infer<typeof HandoffDraftSchema>;

export const HandoffTargetViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  capabilities: z.array(z.enum(AGENT_CAPABILITIES)).min(1).max(2),
}).strict();

export type HandoffTargetView = z.infer<typeof HandoffTargetViewSchema>;

export const AgentResultHandoffSchema = z.object({
  objective: z.string().min(1).max(2_000),
  summary: z.string().min(1).max(10_000),
  artifactRefs: z.array(HandoffArtifactRefSchema).max(100).default([]),
  evidenceRefs: z.array(HandoffArtifactRefSchema).max(100).default([]),
  decisions: z.array(z.string().min(1).max(2_000)).max(50).default([]),
  openQuestions: z.array(z.string().min(1).max(2_000)).max(50).default([]),
  risks: z.array(z.string().min(1).max(2_000)).max(50).default([]),
}).strict();

export type AgentResultHandoff = z.infer<typeof AgentResultHandoffSchema>;

export const AgentResultSchema = z
  .object({
    summary: z.string().min(1).max(10_000),
    publicMessage: z.string().min(1).max(10_000).optional(),
    nextAction: NextActionSchema,
    handoff: AgentResultHandoffSchema.optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.nextAction.type === 'handoff' && !result.handoff) {
      context.addIssue({
        code: 'custom',
        path: ['handoff'],
        message: 'A handoff nextAction requires structured Handoff content',
      });
    }
    if (result.handoff && result.nextAction.type !== 'handoff' && result.nextAction.type !== 'request_review') {
      context.addIssue({
        code: 'custom',
        path: ['handoff'],
        message: 'Handoff content requires a handoff or request_review nextAction',
      });
    }
  });

export type AgentResult = z.infer<typeof AgentResultSchema>;

export const ReviewFindingDraftSchema = z
  .object({
    severity: z.enum(FINDING_SEVERITIES),
    filePath: z.string().min(1).max(4_096).optional(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    title: z.string().min(1).max(200),
    detail: z.string().min(1).max(4_000),
    suggestion: z.string().min(1).max(2_000).optional(),
  })
  .superRefine((finding, context) => {
    if (finding.lineEnd !== undefined && finding.lineStart === undefined) {
      context.addIssue({ code: 'custom', path: ['lineEnd'], message: 'lineEnd requires lineStart' });
    }
    if (finding.lineStart !== undefined && finding.lineEnd !== undefined && finding.lineEnd < finding.lineStart) {
      context.addIssue({ code: 'custom', path: ['lineEnd'], message: 'lineEnd must be greater than or equal to lineStart' });
    }
  });

export type ReviewFindingDraft = z.infer<typeof ReviewFindingDraftSchema>;

export const ReviewDraftSchema = z
  .object({
    verdict: z.enum(REVIEW_VERDICTS),
    summary: z.string().min(1).max(10_000),
    findings: z.array(ReviewFindingDraftSchema).max(100).default([]),
  })
  .superRefine((review, context) => {
    const actionable = review.findings.some((finding) =>
      finding.severity === 'blocking' || finding.severity === 'should_fix',
    );
    const blocking = review.findings.some((finding) => finding.severity === 'blocking');
    if (review.verdict === 'approved' && actionable) {
      context.addIssue({ code: 'custom', path: ['findings'], message: 'approved reviews cannot contain actionable findings' });
    }
    if (review.verdict === 'changes_requested' && !actionable) {
      context.addIssue({ code: 'custom', path: ['findings'], message: 'changes_requested requires an actionable finding' });
    }
    if (review.verdict === 'blocked' && !blocking) {
      context.addIssue({ code: 'custom', path: ['findings'], message: 'blocked requires a blocking finding' });
    }
  });

export type ReviewDraft = z.infer<typeof ReviewDraftSchema>;

export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('run.prepared'),
    worktreePath: z.string().min(1),
    workingDirectory: z.string().min(1),
    branchName: z.string().min(1),
  }),
  z.object({ type: z.literal('run.bootstrap_started'), stepCount: z.number().int().nonnegative() }),
  z.object({
    type: z.literal('run.bootstrap_step_completed'),
    stepIndex: z.number().int().nonnegative(),
    name: z.string().min(1),
    command: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
    outputSummary: z.string().optional(),
  }),
  z.object({
    type: z.literal('run.bootstrap_completed'),
    stepCount: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('run.bootstrap_failed'),
    stepIndex: z.number().int().nonnegative(),
    name: z.string().min(1),
    code: z.enum(['spawn_failed', 'timeout', 'non_zero_exit']),
    message: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('run.started'), sessionRef: z.string().optional() }),
  z.object({ type: z.literal('output.delta'), text: z.string() }),
  z.object({
    type: z.literal('tool.called'),
    callId: z.string().min(1),
    name: z.string().min(1),
    inputSummary: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('tool.completed'),
    callId: z.string().min(1),
    outputSummary: z.unknown().optional(),
  }),
  z.object({ type: z.literal('handoff.requested'), handoff: HandoffDraftSchema }),
  z.object({
    type: z.literal('handoff.consumed'),
    handoffId: z.string().uuid(),
    bundleVersion: z.number().int().positive(),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({ type: z.literal('review.submitted'), review: ReviewDraftSchema }),
  z.object({ type: z.literal('run.completed'), outcome: RunOutcomeSchema }),
  z.object({ type: z.literal('run.cancelled'), reason: z.string().optional() }),
  z.object({
    type: z.literal('run.failed'),
    code: z.enum(['spawn_failed', 'bootstrap_failed', 'protocol_error', 'timeout', 'process_exit', 'unknown']),
    message: z.string().min(1),
  }),
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;

export interface Task {
  id: string;
  workspaceId: string;
  threadId?: string;
  conversationContextBeforeSequence?: number;
  conversationContextPolicyVersion?: number;
  title: string;
  description: string;
  agentId: string;
  reviewerAgentId?: string;
  acceptanceCriteria: string[];
  completionPolicy: CompletionPolicy;
  maxReviewRounds: number;
  status: TaskStatus;
  currentRunId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadSummary {
  id: string;
  workspaceId: string;
  title: string;
  messageCount: number;
  activeTaskCount: number;
  lastMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  sequence: number;
  taskId?: string;
  runId?: string;
  senderType: 'user' | 'agent' | 'system';
  senderName: string;
  senderAgentId?: string;
  recipientAgentId?: string;
  content: string;
  createdAt: string;
}

export interface MessageDispatch {
  id: string;
  messageId: string;
  taskId: string;
  agentId: string;
  createdAt: string;
}

export interface ThreadDetail {
  thread: ThreadSummary;
  messages: ThreadMessage[];
  dispatches: MessageDispatch[];
  tasks: Task[];
}

export interface Handoff {
  id: string;
  bundleVersion: number;
  sourceRunId: string;
  targetAgentId: string;
  targetRunId?: string;
  objective: string;
  contextSummary: string;
  artifactRefs: HandoffArtifactRef[];
  evidenceRefs: HandoffArtifactRef[];
  acceptanceCriteria: string[];
  decisions: string[];
  openQuestions: string[];
  risks: string[];
  nextAction?: NextAction;
  contentDigest?: string;
  status: 'pending' | 'accepted' | 'dispatched' | 'rejected' | 'cancelled' | 'expired';
  createdAt: string;
  updatedAt: string;
}

export interface ReviewFinding extends ReviewFindingDraft {
  id: string;
  reviewId: string;
  createdAt: string;
}

export interface Review {
  id: string;
  taskId: string;
  runId: string;
  round: number;
  verdict: ReviewVerdict;
  summary: string;
  findings: ReviewFinding[];
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  bootstrapPolicy: BootstrapPolicy;
  defaultCompletionPolicy: CompletionPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderConnection extends ProviderConnectionSnapshot {
  workspaceId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfile {
  id: string;
  workspaceId: string;
  name: string;
  adapterType: AgentAdapterType;
  providerConnectionId?: string;
  provider?: string;
  modelLabel?: string;
  modelFamily?: string;
  capabilities: string[];
  config: Record<string, unknown>;
  instructions?: string;
  executionPolicy?: ExecutionPolicy;
  enabled: boolean;
}

export interface AgentProfileSnapshotSummary {
  id: string;
  name: string;
  adapterType: AgentAdapterType;
  provider?: string;
  modelLabel?: string;
  modelFamily?: string;
  capabilities: string[];
  executionPolicy?: ExecutionPolicy;
}

export interface AgentHealth {
  status: 'healthy' | 'unhealthy';
  adapterType: AgentAdapterType;
  version?: string;
  model?: string;
  modelAvailable?: boolean;
  checkMode?: 'configuration' | 'live';
  credentialAvailable?: boolean;
  requestAttempted?: boolean;
  message: string;
}

export interface AgentRuntimeDescriptor {
  adapterType: AgentAdapterType;
  label: string;
  available: boolean;
  version?: string;
  models: string[];
  message: string;
}

export interface Run {
  id: string;
  taskId: string;
  agentId: string;
  status: RunStatus;
  attempt: number;
  triggerType: 'user' | 'handoff' | 'review' | 'retry';
  parentRunId?: string;
  retryOfRunId?: string;
  workspaceRoot: string;
  bootstrapPolicySnapshot: BootstrapPolicy;
  agentProfileSnapshot?: AgentProfileSnapshotSummary;
  worktreePath?: string;
  workingDirectory?: string;
  branchName?: string;
  workerId?: string;
  leaseExpiresAt?: string;
  sessionRef?: string;
  failureCode?: string;
  failureDetail?: string;
  outcome?: RunOutcome;
  version: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface RunEvent {
  id: number;
  taskId: string;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  source: 'api' | 'worker' | 'agent' | 'user';
  occurredAt: string;
  dedupeKey: string;
}

export type CoordinationOwnerKind = 'agent' | 'user' | 'platform' | 'none';
export type CoordinationVerdictStatus = 'not_requested' | 'pending' | ReviewVerdict;
export type CoordinationRouteAction = NextAction['type'] | 'terminal';
export type CoordinationReason =
  | 'task_draft'
  | 'task_terminal'
  | 'current_run_missing'
  | 'run_waiting_for_dispatch'
  | 'run_owned_by_agent'
  | 'handoff_waiting_for_dispatch'
  | 'review_waiting_for_dispatch'
  | 'review_in_progress'
  | 'repair_in_progress'
  | 'handoff_pending'
  | 'workflow_resolution_pending'
  | 'user_confirmation_required'
  | 'user_attention_required'
  | 'cancellation_in_progress';

export interface TaskCoordinationView {
  state: {
    taskStatus: TaskStatus;
    runId?: string;
    runStatus?: RunStatus;
  };
  owner: {
    kind: CoordinationOwnerKind;
    reason: CoordinationReason;
    agentId?: string;
    runId?: string;
    label?: string;
  };
  evidence: {
    commandCount: number;
    succeededCommandCount: number;
    failedCommandCount: number;
    artifactCount: number;
    evidenceRefCount: number;
    handoffId?: string;
    handoffStatus?: Handoff['status'];
    handoffVersion?: number;
  };
  verdict: {
    status: CoordinationVerdictStatus;
    findingCount: number;
    reviewId?: string;
    round?: number;
    summary?: string;
  };
  route: {
    action: CoordinationRouteAction;
    reason: CoordinationReason;
    allowedActions: NextAction['type'][];
    targetAgentId?: string;
  };
}

export interface TaskDetail {
  task: Task;
  runs: Run[];
  events: RunEvent[];
  handoffs: Handoff[];
  reviews: Review[];
  coordination: TaskCoordinationView;
}

export interface ClaimedRun {
  task: Task;
  run: Run;
  workspace: Workspace;
  agent: AgentProfile;
  handoff?: Handoff;
  review?: Review;
  handoffTargets?: HandoffTargetView[];
  conversationContext?: ConversationContextView;
}

export interface ClaimedExecution {
  claimed: ClaimedRun;
  executionToken: string;
  lease: {
    expiresAt: string;
    heartbeatIntervalMs: number;
  };
}

export interface RealtimeEnvelope {
  eventId: number;
  taskId: string;
  runId: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export const RunQueueJobSchema = z.object({
  runId: z.string().uuid(),
});
export type RunQueueJob = z.infer<typeof RunQueueJobSchema>;
