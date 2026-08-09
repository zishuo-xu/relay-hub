# ADR-013：Workspace 级 Provider Connection 与 Agent 引用

## 状态

Accepted / Implemented（2026-08-09）

## 背景

把 Base URI、API 协议、凭证环境变量和模型列表重复填写到每个 AgentProfile，会造成配置漂移，也会把“Agent 身份”和“模型入口”混成一个对象。另一方面，RelayHub 仍必须保持三层边界：模型负责推理，Agent CLI 负责工具执行，RelayHub 负责身份、编排、隔离和审计。

## 决策

1. 新增 Workspace 所属的 `ProviderConnection`，分为 `official_cli` 和 `custom_api`。
2. 官方连接由 Codex CLI 或 OpenCode CLI 管理登录；自定义连接集中保存协议、Base URI、凭证环境变量名称和模型目录，不保存密钥值。
3. AgentProfile 选择运行 CLI、ProviderConnection 和模型。自定义 API 第一版由 OpenCode CLI 执行；RelayHub 不实现一个缺少编码工具的“直连模型 Agent”。
4. 自定义 OpenAI Chat Completions 使用 OpenCode 的 `@ai-sdk/openai-compatible` provider；OpenAI Responses 使用 `@ai-sdk/openai`。Worker 在每个 Run 启动时通过 `OPENCODE_CONFIG_CONTENT` 注入临时配置。
5. AgentProfile 的非敏感连接快照进入不可变 Run AgentProfile snapshot。连接之后修改，不改变已经创建的 Run。
6. 旧 AgentProfile 的 `providerConnectionId` 继续允许为空；已有 `provider/model` 配置保持兼容。
7. 健康检测只验证 CLI 能读取注入后的模型目录，不发送计费模型请求，也不声称 API Key 或余额有效。

## 结果

- 一个第三方 URI 可以被多个 Builder/Reviewer Agent 复用。
- Agent 配置不再重复保存 URI 和密钥引用。
- CLI、连接和模型的兼容性由服务端校验。
- 平台仍只控制 Agent；实际模型调用和工具执行发生在所选 Agent CLI 中。
