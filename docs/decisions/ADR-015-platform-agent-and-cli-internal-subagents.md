# ADR-015：平台 Agent 与 CLI 内部子 Agent 的责任边界

## 状态

Accepted / Implemented（2026-08-09）

## 背景

Codex、OpenCode、Claude 等 Agent CLI 可以自行把一个较大目标拆成多个维度，并调用自己的内部子 Agent 并行分析或执行。如果 RelayHub 继续管理这些内部拆分的数量、深度和任务结构，会重复实现 CLI 已经具备的编排能力，并把平台控制面与 Agent 内部策略耦合。

另一方面，CLI 内部子 Agent 不能借此获得新的平台身份、越过父 Run 权限，或伪装成独立 Builder/Reviewer，否则 AgentProfile、Handoff、Review 和审计边界都会失真。

## 决策

1. RelayHub 只管理平台级 `AgentProfile + Run`。平台 Agent 是 Task 责任主体，拥有独立身份、Run Token、权限快照、状态和审计记录。
2. CLI 内部子 Agent 是父 Run 的实现细节。如何拆分问题、创建多少子 Agent、采用何种内部协作方式，由主 Agent/CLI 自己决定，RelayHub 不建立第二套子 Agent 编排器。
3. 权限配置只提供 `internalSubagents = deny | allow`。第一版不配置内部数量、深度或每个子 Agent 的角色。
4. 内部子 Agent 运行在父 Run 的执行边界内，只能继承或缩小父 Run 的文件、命令、网络和 Git 权限，不能自行扩权。
5. 内部子 Agent 不拥有独立 AgentProfile、Run Token、Task ownership、Handoff 或 Review authority；其平台写操作一律归因于父 Run，API 继续按父 Run Token 和数据库角色校验。
6. 如果一个内部子任务需要独立身份、长期状态、独立权限、Worktree、Handoff 或最终裁决，主 Agent 必须向 RelayHub 请求创建新的平台 Run，不能在 CLI 内部原地“晋升”。
7. Run 超时、取消、总费用/Token 预算和进程回收作用于整个父 Run 进程树。是否记录 provider 内部子 Agent 的嵌套事件属于可观测性增强，不改变平台身份模型。

## 结果

- RelayHub 继续专注于身份、责任、外层权限、交接和审计，不与各 CLI 竞争内部任务拆解能力。
- 主 Agent 可以自主利用 CLI 原生多 Agent 能力处理较大的多维问题。
- 内部子 Agent 不能伪装成平台独立 Agent，也不能绕过父 Run 的权限快照。
- 后续接入新的 CLI 时，只需声明是否支持内部子 Agent以及如何保证父权限覆盖整个执行树。

## 实现说明

- `ExecutionPolicy.internalSubagents` 已进入 Agent 配置和不可变 Run AgentProfile 快照。
- OpenCode Adapter 通过 `permission.task` 映射允许/禁止；Codex 由 RelayHub Prompt 和父 Run permission profile 共同约束，内部线程不获得平台 Token 或 API 身份。
- 权限模板默认允许 Builder 使用内部子 Agent、禁止 Reviewer 和只读分析 Agent 使用；用户可在 Agent 配置中覆盖该单项，但不能扩大父 Run 的文件、网络、外部目录或 Git 边界。
