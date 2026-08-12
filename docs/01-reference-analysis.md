# 01. Clowder AI 参考分析

## 分析目的

这份分析用于提取可学习的工程问题和设计模式，不作为源码移植清单。RelayHub 会重新定义自己的产品边界、领域模型和代码结构。

## 原项目的核心分层

Clowder AI 的关键思想可以概括为三层：

| 层 | 职责 | RelayHub 的对应处理 |
|---|---|---|
| 模型 | 理解、推理与生成 | 视为外部能力，不纳入平台实现 |
| Agent CLI | 工具使用、文件操作、执行会话 | 通过 Adapter 接入 |
| 协作平台 | 身份、路由、线程、记忆、纪律和审计 | 作为 RelayHub 的核心 |

这说明真正有工程价值的问题不是“再封装一次模型 API”，而是如何管理 Agent 的执行生命周期和协作关系。

## 参考项目的产品主次

状态：**Accepted（2026-08-13）。**

重新核对参考项目的 README、Chat、Hub、Mission Hub、multi-mention 和 session handoff 设计后，RelayHub 必须保持以下主次关系：

| 层次 | 参考项目的做法 | RelayHub 应学习的含义 |
|---|---|---|
| 主入口 | 多线程 Chat；一个线程对应一个功能、问题或主题 | 对话线程是用户与 Agent 团队持续协作的空间 |
| 协作语法 | 用户或 Agent 使用 `@mention` 路由给一个或多个独立 Agent | 自然语言负责交互，平台把路由意图转换为可验证执行 |
| Agent 协作 | 普通咨询使用消息协调；真正转移责任时才使用结构化 assign/handoff | 不把每次讨论都强迫成工作流状态迁移 |
| Hub | 能力、Skills、配额、路由策略、账号和模型配置 | 配置能力是控制中心，不是每个任务重复填写的表单 |
| Mission Hub | 功能生命周期、责任、风险和治理视图 | Task/Review/审计是第二观察面，不应吞掉 Chat 主入口 |

因此，RelayHub 不能把“创建 Task → 看技术 Timeline → 等状态机结束”当作最终产品形态。现有 Task、Run、Handoff、Review、Outbox、Lease 和 Timeline 是可靠运行底座；下一阶段应让这些能力服务于可见的多 Agent 对话，而不是继续增加 Git 交付中心或通用流程编辑器。

## 值得借鉴的能力

### 1. Adapter 统一异构 Agent

原项目通过不同 Agent Service 对接 CLI，并把各自的 NDJSON 或文本输出转换为统一消息。RelayHub 保留这个思路，但重新定义更小的接口：

```ts
interface AgentAdapter {
  start(input: StartRunInput): AsyncIterable<AgentEvent>;
  resume(input: ResumeRunInput): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
  healthCheck(): Promise<AgentHealth>;
}
```

统一事件只包含 MVP 真正需要的类型：`run.started`、`output.delta`、`tool.called`、`run.completed`、`run.failed`。

### 2. Invocation 是一等实体

原项目没有把一次 Agent 调用仅仅当作 HTTP 请求，而是为它保存调用 ID、所属线程、Agent、父调用、过期时间和鉴权信息。RelayHub 将其简化为 `run` 实体，并保留父子关系和幂等键。

### 3. 线程作用域的实时广播

原项目通过 Socket.IO 房间隔离线程事件，并使用线程内递增序号处理事件缺口。RelayHub 采用同类模式：数据库事件 ID 是可恢复的事实，WebSocket 只是低延迟投影。

### 4. Agent 间交接不是普通文本

原项目用 TeamAct、A2A、mention 路由和球权概念表达“谁应当继续行动”。RelayHub 不复制完整球权体系，而是提炼为 `State → Owner → Action → Evidence → Verdict → Route` 六步协作语义：Agent 通过封闭的 `NextAction` 提出继续、交接、审查、等待或完成意图，平台验证后再写入结构化 `handoff`、后续 Run 和审计事件。当前责任优先从既有 Task/Run/Handoff/Event 推导，不提前增加重复生命周期实体。

### 5. 记忆的真相源与索引分离

原项目强调 canonical truth、索引、cue 和反馈不是同一层。RelayHub 第二阶段若加入记忆，也只允许已确认的任务结论进入知识表；Embedding 或全文索引只是可重建投影，不成为事实来源。

## 不直接照搬的部分

| 原项目能力 | RelayHub 决策 | 原因 |
|---|---|---|
| 持久人格与陪伴体验 | 不做 | 与面试主线无关 |
| 大规模 Skills 和 SOP 治理 | 只保留 Review 工作流 | MVP 需要控制范围 |
| 完整共享记忆体系 | 第二阶段做轻量版本 | 原系统复杂度远超个人项目所需 |
| MCP 回调桥和多种 CLI | 首版最多两个真实 Adapter | 先证明抽象有效 |
| 桌面端、IM、语音、游戏 | 不做 | 不增加核心技术证明力 |
| 大量 feature governance | 用 ADR + 小型 issue 列表替代 | 保持个人项目迭代效率 |

## 从原项目复杂度中得到的反向结论

### 结论一：先做模块化单体

MVP 的一致性和调试效率比独立部署更重要。API、编排器和事件写入先放在同一个后端进程，Agent Worker 单独运行以隔离子进程风险。只有出现明确吞吐瓶颈后才继续拆分。

### 结论二：事件流不能代替持久状态

WebSocket 消息可能丢失或重复。所有关键状态先事务性写入数据库，再向前端广播。重连时前端从 `afterEventId` 继续补拉。

### 结论三：执行状态必须由现实事件推进

只有 Worker 成功领取任务后才能进入 `running`；只有 Agent 退出码、协议结束事件或平台裁决才能进入终态。前端展示不能反过来决定业务状态。

### 结论四：失败语义要结构化

至少区分 `spawn_failed`、`protocol_error`、`timeout`、`cancelled` 和 `process_exit`。否则自动重试、告警和面试中的可靠性说明都会失去依据。

## 多 Agent 隔离与身份连续性

状态：**Accepted，作为 RelayHub 后续多 Agent 实现原则。**

多 Agent 不等于同一个模型临时扮演多个名字。每个 Agent 应当拥有独立的运行身份、会话和调用边界；平台只负责装配可见上下文和传递显式产物。

### 隔离层次

| 隔离层 | 目标 | RelayHub 计划 |
|---|---|---|
| 进程/Adapter | 一个 Agent 的协议错误不污染另一个 Agent | 每个 Run 通过自己的 Adapter 和受控子进程执行 |
| Session | 不恢复别的 Agent 或别的 Task 的上下文 | Session key 至少包含 workspace、agent、task/thread |
| 并发 | 同一可恢复 Session 不被同时写入 | 对 sessionRef 做互斥或串行队列 |
| Invocation | 旧执行不能以回调污染新执行 | Run token、有效期、latest-run 校验和幂等键 |
| 消息可见性 | 路由目标不等于访问权限 | Handoff target 与 Thread visibility 分别判断 |
| 文件副作用 | 并行 Agent 不覆盖彼此修改 | 需要并行写代码时使用独立 Git worktree |

### “保持自己的思想”的准确含义

平台不读取、不传递也不保存模型的隐藏推理过程。可持续的是：

- 每次调用重新注入的 AgentProfile、行为边界和协作规则；
- 这个 Agent 自己的可恢复 CLI Session；
- 显式保存的结论、证据、摘要、任务状态和自我交接；
- 经过授权检索的项目知识。

Reviewer 默认接收原始需求、代码差异、测试证据和结构化 Handoff，不直接继承 Builder 的隐藏推理。这样才能保留跨 Agent 独立判断的价值。

## Agent 间通信原则

状态：**Accepted，顺序型结构化 Handoff 已实现；对话消息与 `@mention` 路由尚未实现。**

Agent 不直接调用另一个 Agent 的模型会话。通信必须经过平台：

```text
Agent A 提交结构化 Handoff
  -> API 验证来源 Run
  -> 持久化 Handoff 与 Outbox
  -> Queue 唤醒目标 Agent B
  -> B 使用自己的 AgentProfile 与 Session 执行
  -> B 提交 Review、结果或下一次 Handoff
```

结构化 Handoff 至少包含来源 Run、目标 Agent、任务摘要、产物引用和验收要求。自然语言中的 `@name` 可以作为界面语法，但不能成为唯一可靠的执行协议。

## 简化 TeamAct 与动态责任流转

状态：**Accepted，参见 ADR-017。**

RelayHub 参考原项目的动态责任流转机制，但不建设通用 Workflow Engine，也不把每种专业角色写入平台状态机：

- Task 始终能解释当前由用户、某个 Agent Run 还是平台等待条件负责；
- Agent 负责判断下一步意图，Orchestrator 负责校验并执行状态与责任变化；
- 方案设计、UX、安全和测试属于 AgentProfile 的提示词/专业方向，不产生新的平台权限身份；
- SOP 或未来协作配方只提供建议路径与门禁，不能执行任意脚本或放宽权限；
- 第一版保持单责任、串行 Handoff 和独立 Review，可靠性完成后才扩展并行 fan-out。

该取舍保留了参考项目最有价值的责任、证据和路由契约，同时避免复制其面向更广场景形成的 Task、Thread、Ball、Invocation、Receipt、Waiting、Pack 等完整概念集合。

## 控制台 UX 参考原则

状态：**Accepted；固定壳层已实现，对话优先的信息架构尚未实现。**

RelayHub 参考的是 Clowder AI 控制台的信息组织方式，而不是它的品牌、文案、组件源码或视觉资产。提炼出的原则如下：

- 使用固定应用外壳，把全局入口、任务导航和当前工作区分成稳定层级；
- 主工作区优先展示当前 Task 的状态与事件，减少与执行无关的大标题和装饰；
- 用背景层级、留白和细分隔线区分区域，避免所有内容都堆叠为高对比度卡片；
- 状态色只承担识别和反馈作用，不作为大面积主题色；
- 长任务列表和时间线在各自区域内部滚动，保证页面本身保持单视口；
- 创建任务属于低频操作，使用按需展开的抽屉，不长期挤占主工作区。
- 用户首先看到任务目标、协作阶段、最新结论和关键节点；完整 Agent 输出、工具调用和平台事件作为按需打开的运行日志，而不是默认占据主视图。
- 任务导航默认突出待处理项，已完成历史通过显式筛选访问，避免历史数据增长后持续稀释当前工作焦点。

当前实现采用 RelayHub 自己的深色活动栏、暖灰任务侧栏和白色任务工作区，并将展示组件从页面的数据与状态逻辑中拆出。下一次信息架构演进应保留固定壳层，但把中心工作区从“技术 Timeline”校准为“多 Agent 对话”；Task 状态、Run 日志、工具调用和平台事件进入按需展开的治理/审计层。

## 持续参考门禁

状态：**Accepted（2026-08-13）。**

以后每个大特性在进入实现前都回答四个问题：

1. 它对应参考项目正在解决的哪个协作问题？
2. 它服务 Chat、Hub 还是 Mission/Governance 层？
3. 它是否减少用户手工路由、补上下文或追状态的负担？
4. 它是否把支撑能力误抬成产品主入口，或复制了与 RelayHub 边界无关的复杂度？

若无法回答，应暂停实现并先重新核对本地参考项目。该门禁约束产品方向，不授权复制参考项目源码、组件或品牌资产。

## 本次分析使用的本地参考入口

- `../../README.zh-CN.md`：产品定位、能力列表和三层原则。
- `../../docs/architecture/cli-integration.md`：CLI 子进程、事件转换和生命周期问题。
- `../../packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts`：调用身份、父子关系、TTL 和幂等边界。
- `../../packages/api/src/infrastructure/websocket/SocketManager.ts`：线程房间、事件序号和连接安全。
- `../../packages/shared/src/types/a2a.ts`：结构化 Agent-to-Agent 任务与消息模型。
- `../../docs/architecture/memory-system-overview.md`：真相源、索引、运行时提示与反馈的分层。

## Clean-room 约束

1. 不从原项目复制类、函数或测试。
2. 先写 RelayHub 的需求和接口，再实现代码。
3. 领域名称使用 `workspace/task/run/handoff/review`，不沿用“猫、球权”等内部语言。
4. 原项目只作为设计案例；代码评审时能够解释 RelayHub 每个模块的独立取舍。
5. UX 只提炼信息架构与交互原则，不复制原项目组件源码、品牌语言或视觉资产。
