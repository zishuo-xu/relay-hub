# ADR-013：Workspace 级 Provider Connection 与 Agent 引用

## 状态

Accepted / Implemented（2026-08-09；Web 数据库凭证扩展 2026-08-14）

## 背景

把 Base URI、API 协议、凭证环境变量和模型列表重复填写到每个 AgentProfile，会造成配置漂移，也会把“Agent 身份”和“模型入口”混成一个对象。另一方面，RelayHub 仍必须保持三层边界：模型负责推理，Agent CLI 负责工具执行，RelayHub 负责身份、编排、隔离和审计。

## 决策

1. 新增 Workspace 所属的 `ProviderConnection`，分为 `official_cli` 和 `custom_api`。
2. 官方连接由对应 CLI 管理登录；自定义连接集中保存协议、Base URI、可选凭证环境变量名称和模型目录。用户默认从 Web 写入 API Key，API Key 保存到本地 PostgreSQL 的专用连接凭证列。
3. AgentProfile 选择运行 CLI、ProviderConnection 和模型。自定义 API 第一版由 OpenCode CLI 执行；RelayHub 不实现一个缺少编码工具的“直连模型 Agent”。
4. 自定义 OpenAI Chat Completions 使用 OpenCode 的 `@ai-sdk/openai-compatible` provider；OpenAI Responses 使用 `@ai-sdk/openai`。Worker 在每个 Run 启动时通过 `OPENCODE_CONFIG_CONTENT` 注入临时配置。
5. AgentProfile 的非敏感连接快照进入不可变 Run AgentProfile snapshot。连接之后修改，不改变已经创建的 Run。数据库凭证不进入快照或公有响应；API 在 Worker claim 时按连接 ID 读取并作为瞬时执行字段返回，Worker 仅在子进程环境中持有。
6. 已持久化的旧 AgentProfile 和 Run 快照可继续按原配置执行；新的 Agent 创建和编辑必须引用 ProviderConnection，Agent 输入不再接受凭证字段。
7. 默认健康检测只验证 CLI、数据库/环境变量凭证可用性和注入后的模型目录，不发送计费请求。自定义连接另提供显式 `live` 检测；用户必须在 Web 确认可能产生费用后，平台才在临时空目录中向选定模型发送固定无敏感测试文本，随后清理该临时目录。
8. ProviderConnection 的 `kind` 与 `adapterType` 创建后不可修改。连接被启用 Agent 使用时不能停用，也不能移除这些 Agent 正在使用的模型；应先迁移或停用 Agent。

## 结果

- 一个第三方 URI 可以被多个 Builder/Reviewer Agent 复用。
- Agent 配置不再重复保存 URI 和密钥引用。
- Web 直接配置是本地优先默认路径；环境变量名称保留为 CI、远程 Worker 和旧配置的高级兼容路径。
- API 只返回 `credentialConfigured` 状态，不返回、记录或写入 Run 快照中的密钥值。
- CLI、连接和模型的兼容性由服务端校验。
- 平台仍只控制 Agent；实际模型调用和工具执行发生在所选 Agent CLI 中。
- 连接编辑只影响未来创建的 Run；历史 Run 继续使用自己的不可变连接快照。
