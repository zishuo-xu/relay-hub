# ADR-016：Agent 长期提示词与统一执行权限快照

## 状态

Accepted / Implemented（2026-08-09）

## 背景

AgentProfile 已经负责可复用身份、CLI、模型和能力，Run 则在创建时保存完整 AgentProfile 快照。长期角色偏好和执行权限如果只存在前端或 Worker 的硬编码中，用户无法配置，也无法解释某个历史 Run 当时为何获得这些能力。

同时，Codex、OpenCode 与 Claude Code 的权限原语不同。平台不能假装三者具备完全相同的沙箱能力，也不能为了统一界面而把某个 CLI 不支持的策略静默放宽。

## 决策

1. AgentProfile 增加可选长期提示词 `instructions`。平台规则、Run 权限和任务事实始终优先；长期提示词作为低优先级角色偏好注入单次 Prompt。
2. AgentProfile 增加统一 `ExecutionPolicy`：
   - `fileAccess = read_only | workspace_write`
   - `commandAccess = deny | allow`
   - `networkAccess = none | loopback | outbound`
   - 第一版固定 `externalDirectoryAccess = deny`
   - 第一版固定 `gitAccess = none`
   - `internalSubagents = deny | allow`
3. Web 默认提供 Builder、Reviewer、只读分析三种模板，并允许单独开关 CLI 内部子 Agent。保存的是展开后的完整策略，不依赖模板名称解释历史行为。
4. 统一策略和长期提示词保存在 AgentProfile 的通用 JSONB config 中；API 映射为 AgentProfile 顶层字段。Run 已保存完整不可变 AgentProfile snapshot，因此无需增加第二套快照列或数据库 migration。
5. Reviewer Run 在创建时的身份快照基础上继续强制收紧为只读、禁止外部目录和禁止 Git；Profile 修改只影响未来 Run。
6. Adapter 只能等价映射或收紧策略，不能扩权：
   - Codex 用命名 permission profile 实现只读/工作区可写与回环网络；禁止内部子 Agent 时显式关闭 `multi_agent` / `multi_agent_v2`；不接受当前 Adapter 无法保证的命令全禁和外部网络策略。
   - OpenCode 用 `edit`、`bash`、`webfetch`、`external_directory`、`task` 权限映射；只读 Run 同时禁用 bash，防止通过 shell 绕过文件只读，因此可能比统一策略更严格；可写 Run 的 bash 规则显式拒绝常规 `git commit` / `git push` 调用。
   - Claude Code 用显式 `--tools` / `--allowedTools` 映射能力。只读 Run 只暴露 `Read`、`Glob`、`Grep`，不提供 Bash、写入、网络或 Task；可写 Run 按快照开放编辑、命令、Web 和内部 Task，并用 `--disallowedTools` 禁止常规 commit、push、merge 与 rebase。CLI 使用非交互 `dontAsk` 模式，不把审批责任留给无人值守子进程。
   - 保存时拒绝当前 CLI 无法可靠执行的策略组合，不静默降级为更宽权限。
7. 内部子 Agent 仍属于父 Run 的实现细节，继承同一 Prompt、进程和权限边界，不获得平台 AgentProfile、Run Token、Handoff 或 Review 身份。

## 结果

- 用户可以为每个 Agent 固化角色思路和执行边界，并在更换模型时继续复用。
- 每个 Run 都能复现创建时的 Agent 指令与权限，不会被之后的 Profile 编辑改变。
- 平台保持一套统一语言，CLI Adapter 负责诚实表达实际能力差异。
- 第一版不开放外部目录、commit 或 push；这些能力只有在可审计、可强制的 Adapter 方案完成后才能扩展枚举和 UI。
