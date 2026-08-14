# ADR-023：区分并行回答与 Lead 主导协作

- 状态：Accepted / Implemented
- 日期：2026-08-14

## 背景

一条 Thread Message 已经可以原子派发给多个 Agent，但该能力表达的是“同一个问题分别回答”。如果页面把它统称为多 Agent 协作，用户会自然期待平台先拆分任务、给出不同分工并最终汇总；实际却只得到多份重复答案。

RelayHub 已有受控 Consultation：责任 Agent 可以向另一个平台 Agent 提出有限问题，平台持久化咨询、独立执行目标 Run，再恢复原 Agent 综合。因此真正的 Lead 协作不需要引入通用 DAG，只需要明确产品模式并把现有闭环组合起来。

## 决策

### 1. Thread 输入提供两种明确模式

- `parallel`（分别回答）：一条公开消息为每个目标 Agent 创建独立 Task/Run。Agent 彼此不分工，也没有自动综合。
- `coordinated`（协作完成）：用户从 2–4 个 Agent 中指定一个 Lead。平台只创建一个 Lead Task；其余 Agent 作为该 Task 的允许协作者。

两种模式共享 Thread、公开 ConversationContext 和审计体验，但不共享状态语义。

### 2. Lead 是唯一责任主体

Lead Task 持久化 `collaborationMode=lead` 与 `collaboratorAgentIds`。Task、currentRun、完成策略和最终结果仍只有一个责任主体，避免把多个 Agent 塞进一个复合 Task 状态机。

Lead 负责：

1. 理解用户最终目标并拆分不同视角或有限问题。
2. 通过结构化 Consultation 逐个邀请已选择的协作者。
3. 评估咨询结果，保留重要分歧。
4. 生成一份统一的最终公开结果。

协作者只回答被分配的问题，不取得 Task ownership。真正转移剩余工作仍使用 Handoff。

### 3. 平台执行硬边界，分工保留为 Agent 智能

平台保证：

- coordinated 请求必须包含 Lead 和至少一名协作者；
- 只创建一个初始 Lead Run，不伪造协作者 Task；
- Lead 的路由候选只暴露用户选择的协作者和可选 Reviewer；
- Consultation 继续保持只读、单层、最多三次、可审计和可恢复；
- continuation 自动回到原 Lead。

平台不替模型生成固定分工表，也不猜测自然语言 `@name`。分工内容由 Lead 根据当前目标决定，责任、身份、Run 和交接由确定性代码约束。

### 4. UX 显式展示语义

Composer 使用“分别回答 / 协作完成”切换。协作模式把第一名标为“主导”，允许用户把任一已选 Agent 设为主导；消息记录显示主导者、团队人数和单一协作 Task 卡片。

## 边界与后续

第一版使用既有串行 Consultation，不支持并行分工、投票、任意依赖图或自动重规划。未来只有在真实使用证明串行协作成为瓶颈后，才考虑并行 Assignment；不能为了流程图提前引入通用 Workflow 引擎。

## 后续方向澄清（2026-08-14）

真实使用讨论确认，本 ADR 实现的是“Lead 综合多个有限意见”，不是参考项目意义上的主线程/子任务分工。它作为辅助咨询模式保留；Agent 接受用户目标后自行拆出独立可交付子任务、子任务自治闭环并回报主任务的目标方案，见 [ADR-024](ADR-024-agent-led-task-delegation.md)。ADR-024 尚未实施，不改变本 ADR 已验证的实现事实。
