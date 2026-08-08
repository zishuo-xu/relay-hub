# 06. 简历与面试表达

## 项目名称建议

- 中文：多 Agent 协作与任务编排平台
- 英文：RelayHub — Multi-Agent Collaboration Control Plane

最终名称可以更换，但简历标题应先说明它解决的问题，避免只有抽象品牌名。

## 简历项目描述模板

> RelayHub 是一个使用 TypeScript 构建的多 Agent 协作与任务编排平台。平台通过统一 Adapter 接入异构 Agent CLI，使用显式状态机和异步队列管理长时间执行，以持久事件流驱动 WebSocket 实时界面，并把 Agent 间交接与跨模型 Review 建模为可追溯的结构化流程。

## 可使用的简历要点

实现后再把括号替换为真实数据，不能提前虚构指标。

- 设计统一 `AgentAdapter` 协议，将不同 CLI 的命令、JSON/NDJSON 输出和会话语义转换为标准事件，完成 Mock、Codex CLI、OpenCode CLI 三类 Adapter 接入，其中两个是真实 Agent CLI。
- 基于 PostgreSQL 状态机、Outbox 和 Redis 队列实现长任务编排，处理重复投递、Worker lease、取消、失败重试与重启恢复。
- 构建 Task 级持久事件流和 WebSocket 实时 Timeline，通过递增事件 ID 与补拉机制保证断线重连后的完整性。
- 将 Agent-to-Agent 交接和 Review 设计为结构化领域对象，支持父子 Run 追踪、循环保护和阻塞问题驱动的返工流程。
- 使用（真实测试工具）覆盖状态迁移、Adapter 协议、幂等与故障恢复，并通过故障注入验证（真实结果）。

## 30 秒介绍

“很多多 Agent Demo 本质上还是把几次模型调用串起来。我做的 RelayHub 更关注平台层：多个 Agent 的执行如何排队、如何实时展示、失败后如何恢复，以及一个 Agent 如何把带验收标准的工作结构化交给另一个 Agent。我用统一 Adapter 隔离 CLI 差异，用数据库状态机和事件时间线作为真相源，再用队列和 WebSocket完成执行与展示。项目可以稳定演示实现 Agent 到审查 Agent 的完整协作链。”

## 2 分钟技术介绍结构

1. **问题**：多个 Agent 独立运行，人承担上下文搬运和状态追踪。
2. **边界**：模型负责推理，Agent CLI 负责工具，RelayHub 负责协作控制面。
3. **架构**：模块化单体 API 保持一致性，Worker 隔离子进程，队列解耦长任务，WebSocket 做实时投影。
4. **难点**：异构事件转换、任务状态机、重复投递、取消语义、断线恢复和结构化交接。
5. **取舍**：MVP 不做微服务和复杂记忆，先完成可靠的多 Agent 主链路。
6. **证据**：现场演示正常路径与一个故障恢复路径，并展示对应自动化测试。

## 高频追问与回答方向

### 为什么不用模型 API，偏要接 CLI？

CLI 已经包含工具调用、文件访问、会话恢复和用户现有认证；平台要复用的是完整 Agent 能力。代价是协议不统一和子进程管理更复杂，所以需要 Adapter 和 ProcessSupervisor。

Codex 与 OpenCode 不共用命令行参数或事件协议。RelayHub 只在 Adapter 内处理这些差异，向上继续输出同一套 `run.started`、`output.delta`、`tool.called`、`review.submitted` 和终态事件，因此 Orchestrator、数据库和 Web 不需要识别供应商。

### 为什么 Queue 和数据库都保存状态？

Queue 解决投递和执行调度，数据库保存业务真相。队列消息可能重复或过期，不能单独回答 Task 当前状态；Worker 必须用数据库条件更新认领 Run。

### 如何保证 WebSocket 不丢消息？

不保证 WebSocket 本身不丢。关键事件先持久化并分配递增 ID，客户端记录最后 ID；发现断线或序号缺口时，通过 HTTP 补拉。WebSocket 只优化延迟。

### 如何处理 Agent 卡住？

区分无输出和进程死亡。Worker 记录 heartbeat 和进程存活信息；可配置响应超时触发取消链。stderr 仅作诊断，不作为有效进度。最终状态必须等到进程退出或回收结果明确后写入。

### 如何避免两个 Worker 重复执行？

每条队列消息都携带 Run ID。Worker 通过 `queued -> claimed` 的条件更新和 lease 原子认领；更新失败说明已被其他 Worker 处理。所有事件再使用 dedupe key 防止重复追加。

### 为什么不用微服务？

MVP 的主要风险是业务一致性和 Agent 生命周期，而不是独立扩缩容。模块化单体让 Task、Run、Event 与 Outbox 能在一个事务中提交；Worker 因子进程风险单独部署。等观测数据证明某个模块需要独立伸缩时再拆。

### 这个项目与参考项目有什么区别？

Clowder AI 是功能丰富的生产平台，包含身份、记忆、Skills、SOP、桌面端和多种连接器。RelayHub 只选择任务编排、异构 Agent、实时事件、结构化交接和 Review 作为主线，并重新设计领域模型与实现，目的是做出自己能完整解释的最小平台。

## 演示建议

准备两个固定演示：

1. **协作流程**：Builder 完成任务，Reviewer 第一轮返回 changes_requested，平台自动注入 Findings 创建 repair Run，第二轮 approved 后按策略完成。
2. **故障流程**：执行中断开浏览器或终止 Worker，再展示补拉或恢复结果。

演示时不要依赖模型一定生成某段文本。Mock Adapter 负责稳定展示平台能力，真实 Adapter 作为额外证明。

## 诚信边界

- 没有测量过的性能数字不写。
- 没有部署过的规模不写“高并发”。
- 不把参考项目的功能说成自己已实现。
- 每一条简历 bullet 都应能指向代码、测试、指标或演示证据。
