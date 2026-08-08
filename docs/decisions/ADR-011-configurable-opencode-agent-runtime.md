# ADR-011：可配置 OpenCode Agent Runtime

状态：Accepted / Implemented（2026-08-08）

## 背景

RelayHub 已有真实 Codex Adapter，但 Builder 和 Reviewer 角色不能绑定单一供应商。为了让用户从 Web 配置 OpenCode，同时保持架构简洁，需要明确模型标识、凭证、权限、健康检测和供应商事件分别由哪一层负责。

## 决策

1. 复用既有 AgentProfile、Run、Worker、Worktree、Handoff、Review 和统一事件协议；OpenCode 只新增一个 Adapter，不新增队列、状态机或部署单元。
2. OpenCode AgentProfile 保存精确 `provider/model`，并可保存 variant、OpenCode agent 名称和一个凭证环境变量名称。API Key 值永不进入数据库、Run snapshot、Prompt、Event 或 Web 响应。
3. 用户可以通过 `opencode providers login` 使用 OpenCode 自己的凭证存储；选择环境变量时，Worker 只向子进程透传该白名单变量。
4. Worker 使用 `opencode run --pure --format json --model <provider/model> --dir <worktree>`，并把 JSON 事件转换为平台统一事件。OpenCode 即使以退出码 0 返回 error envelope，Run 仍必须失败。
5. 每次 Run 通过 `OPENCODE_CONFIG_CONTENT` 注入高优先级权限。Builder 仅允许当前 Worktree 内的编辑与命令；Reviewer 额外禁用 `edit`、`bash`、外部目录、交互提问和子 Agent task，保持独立只读审查。
6. 健康检测执行 `opencode --version` 与 `opencode models`，确认 CLI 和配置模型可见。它不发起外部模型调用，不消耗额度，也不声称 provider 凭证有效；凭证由第一次真实 Run 验证。
7. Web 当前提供新建 OpenCode AgentProfile；API 同时提供完整更新接口，为后续编辑界面保留稳定合约。
8. OpenCode 的供应商特定字段保存在通用 JSONB `config` 中。既有 schema 已满足需要，本次不创建无意义 migration。

## 结果

- 用户可以把 OpenCode 配置为 Builder 或 Reviewer，并与 Codex/Mock Profile 自由组合。
- Orchestrator、持久化状态机和 Web Timeline 不依赖 OpenCode 的事件格式，新增真实 CLI 没有腐化核心架构。
- 凭证不由 RelayHub 持久化，降低本地配置泄漏风险；健康检测与真实鉴权的语义清楚分离。
- Reviewer 的只读边界由平台每次注入，而不是依赖用户项目中的 OpenCode 配置保持不变。
