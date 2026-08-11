# WI-P3.4-001：顺序型平台 Agent 动态 Handoff

## Metadata

- Status: `READY`
- Architect: RelayHub Architect（唯一委派与验收责任人）
- Implementer: Delegated Developer（唯一实现者）
- Baseline commit: `ba458137a79f637d5c931568e6aa06bc7d2dea73`
- Topic branch: `work/wi-p3.4-001-sequential-agent-handoff`
- Revision: 1
- Created at: 2026-08-11
- Updated at: 2026-08-11

## 1. 用户价值与目标

让一个正在执行的 RelayHub 平台级 Agent 能根据任务证据，把当前工作顺序交给另一个已配置的 AgentProfile，例如：

```text
方案 Agent -> Builder -> UX Agent -> Builder -> Reviewer -> 用户确认
```

本 Work Item 只建立一条单链、串行、可审计的动态 Handoff 主干。用户继续通过 Agent 配置定义 Agent 名称、CLI、模型、长期提示词和执行权限；平台负责验证目标身份、创建独立 Run、传递结构化上下文并保持唯一当前责任人。

完成后，RelayHub 的多 Agent 不再只等于硬编码的 Builder → Reviewer，同时仍保持简洁架构：模型提出路由意图，Orchestrator 是唯一状态迁移和派发执行者。

## 2. 当前系统事实

- `NextAction` 已封闭为 `continue / handoff / request_review / wait_for_user / complete`。
- Handoff V2 已持久化 objective、summary、artifact/evidence refs、decisions、open questions、risks、canonical acceptance criteria、内容摘要和消费确认。
- `handoffs` 已支持任意 `targetAgentId`，`runs.triggerType` 已包含 `handoff`，不需要为本切片增加新的生命周期实体。
- 当前 API 把 `handoff.requested` 限制为 Task 固定 Reviewer，并只创建 `triggerType=review` 的目标 Run。
- Codex、OpenCode 和 Mock Adapter 当前只会自动构造固定 Reviewer Handoff；非 Reviewer 的最终文本还不能安全表达通用路由提议。
- `TaskCoordinationView` 已从 Task、Run、Handoff、Review 和 RunOutcome 推导当前 State、Owner、Evidence、Verdict、Route。
- 每个目标 Run 已冻结独立 AgentProfile 和 ExecutionPolicy snapshot；CLI 内部子 Agent 没有 AgentProfile、Run Token、Handoff 或 Review authority。
- 真实 OpenCode Builder → Handoff V2 → Codex Reviewer 已通过验收，因此本 Work Item 不重复实现或重复验证该固定链路。
- 架构依据：`docs/decisions/ADR-017-simplified-teamact-dynamic-responsibility-routing.md`。

## 3. In scope

- 为非 Review Run 定义可解析、可校验的结构化执行结果，使 Agent 可以提出通用 `handoff`，并携带 Handoff V2 所需内容。
- 将当前 Workspace 内允许接收 Handoff 的平台 AgentProfile 最小目录注入当前 Agent 上下文；只包含路由所需的 ID、名称和 capabilities，不暴露凭证、Provider 配置、其他 Agent 的长期提示词或隐藏 Session。
- 让 API/Orchestrator 区分两条路由：
  - `handoff`：通用顺序交接，创建 `triggerType=handoff` Run，Task 保持 `running`。
  - `request_review`：现有独立审查，仍只允许 Task 指定 Reviewer，创建 `triggerType=review` Run，Task 进入 `reviewing`。
- 通用目标校验：AgentProfile 必须存在、启用、属于同一 Workspace、不是当前来源 Agent，并且是真实平台 AgentProfile。
- 目标 Run 继承同一个 Task 和既有 Worktree/working directory/branch，保存目标 AgentProfile 的新快照，获得自己的 Run Token 和 Session；不恢复来源 Agent Session。
- 通用目标 Agent 必须消费并校验 Handoff V2 digest，使用自己的提示词和权限执行，并可继续提出下一次顺序 Handoff 或请求既有 Reviewer。
- 加入固定的通用顺序交接预算：每个 Task 最多 6 次 `nextAction=handoff`。预算耗尽时不得创建新 Run；Handoff 标记为 `rejected`，Task 转为 `waiting_for_user`，并留下稳定审计原因 `handoff_budget_exhausted`。
- 保持一个 Run 最多一个出站 Handoff、一个 Task 只有一个 `currentRunId`，任何时刻不得并行派发两个目标 Run。
- 将 `TaskCoordinationView`、Timeline 和任务概览中的 Reviewer 专属措辞泛化到通用 Handoff，同时保留 Review verdict 的专属展示。
- 使用确定性 Mock 路径完成自动化端到端测试，并在本地已具备 CLI/Provider 凭证时完成一次真实的双 Agent 顺序 Handoff 冒烟验收。
- 同步实现状态、路线图和相关架构说明。

## 4. Out of scope

- 不实现并行 fan-out、DAG、工作流编辑器、投票、广播、跨 Task Handoff 或外部信号等待。
- 不新增方案、UX、安全等硬编码平台角色、状态或权限身份；专业方向继续由 AgentProfile 名称、长期提示词和权限表达。
- 不允许用户编写脚本、条件表达式或插件来直接改变状态。
- 不允许自然语言 `@agent` 绕过结构化结果和 Orchestrator 校验。
- 不把 CLI 内部子 Agent 升格为平台 AgentProfile，也不为其签发独立 Token、Run 或 Handoff。
- 不改变 Review/Finding、自动返工和 CompletionPolicy 语义。
- 不实现 Worker lease/reconciliation、并发执行或新的基础设施。
- 不新增数据库表、Task 状态、Run 状态、Run trigger、Redis 队列或第三方服务。
- 不建设路由规则配置 UI；本切片由当前 Agent 根据平台提供的候选目录提出目标。

## 5. 架构不变量与禁止事项

- Model 只提出 `NextAction`；只有 Orchestrator 可以创建 Handoff、目标 Run、Event 和 Outbox，或改变 Task 当前责任。
- `handoff` 和 `request_review` 必须保持不同语义。通用 Handoff Run 即使目标 Agent 具有 `review` capability，也不能提交正式 Review；只有 `triggerType=review` 且身份匹配 Task Reviewer 的 Run 有 Review authority。
- 来源 Run 必须是当前 Task 的活动 Run，且处于允许提交事件的状态。历史 Run、其他 Task 或无效 Token 不能发起路由。
- `nextAction.targetAgentId` 必须与 Handoff `targetAgentId` 完全一致。
- Handoff 的 acceptance criteria 继续由平台从 Task canonical truth 写入，不能信任 Agent 提供或改写。
- 来源和目标 Agent 的隐藏 reasoning、Session、Token、凭证及完整配置不得进入 Handoff、Prompt、Timeline 或公共 API。
- 目标 Run 使用目标 AgentProfile 的创建时快照和权限；不能继承来源 Agent 的身份或扩大目标权限。
- 串行 Handoff 复用当前 Worktree，不创建并行写入分支；目标是否可写由目标 Run 的 ExecutionPolicy 决定。
- 现有 Handoff digest、`handoff.consumed`、Outbox 幂等和 Run Event 去重机制必须继续生效。
- 不能用 Event Log 反推或拥有当前状态；Task/Run/Handoff/Review 仍是 canonical facts。
- 不删除、清空或覆盖正式 PostgreSQL、Redis、Worktree 或用户仓库数据。

## 6. 决策边界与开发者自主权

### Architect 已冻结的决定

- 本切片只做顺序型平台 Agent Handoff，不做通用 Workflow Engine。
- 复用现有 Task、Run、Handoff、Outbox、Run Token、AgentProfile snapshot 和 Worktree。
- `handoff` 创建 `triggerType=handoff` Run 并保持 Task `running`；`request_review` 保持现有独立 Review 语义。
- 通用交接预算固定为每 Task 6 次，不在本切片增加用户配置或数据库字段。
- 平台只向来源 Agent公开候选目标的 ID、名称和 capabilities。
- 无迁移、无新基础设施、无新硬编码专业角色。

### Developer 可自主决定

- 结构化非 Review 结果解析器的内部文件组织、函数名称和复用方式。
- Codex/OpenCode/Mock Adapter 如何共享解析、事件生成和回退逻辑。
- Orchestrator 内部怎样拆分纯决策函数、Repository 事务和查询辅助函数。
- 测试 fixture、builder helper、UI 组件拆分和中性文案的具体实现。
- 在允许模块内进行为减少重复而必要的小型重构，只要不改变已冻结合约语义。

### 必须标记 `BLOCKED` 的情况

- 发现必须增加数据库字段/表、新 Task/Run 状态、新队列、并行派发或路由 DSL 才能完成。
- 需要让模型、Adapter、Worker 或 CLI 内部子 Agent直接修改 Task 状态或创建目标 Run。
- 无法在不泄露其他 Agent 凭证、长期提示词、Session 或 Token 的情况下提供路由候选。
- 现有 Handoff 唯一索引、状态机或事务边界无法保证每个来源 Run 只派发一个目标 Run。
- 真实 CLI 验收所需凭证或本机运行条件缺失；不得以伪造证据代替。

## 7. 允许修改的模块

| 模块 | 允许的修改 |
|---|---|
| `packages/contracts` | 结构化非 Review 结果、最小 Handoff target view、投影类型和常量；不得新增生命周期状态 |
| `apps/api/src/workflow-orchestrator.ts` | `handoff` / `request_review` 纯路由决策与预算结果 |
| `apps/api/src/persistence/workflow-repository.ts` | 目标校验、Handoff 持久化、串行目标 Run/Outbox 原子创建和预算收敛 |
| `apps/api/src/persistence/run-execution-repository.ts` | claim 时提供最小候选目录和加载通用 Handoff；不得泄露完整 Profile 配置 |
| `apps/api/src/task-coordination.ts` | 通用 Owner/Route/Evidence 投影 |
| `apps/api` 测试及必要 mapper/type 文件 | 隔离数据库、幂等、越权、预算和兼容测试 |
| `apps/worker/src/agent-prompt.ts` | 通用 Handoff Prompt、候选目录和结构化结果说明 |
| `apps/worker/src/handoff.ts` | 通用 Handoff 构造与 Review Handoff 兼容复用 |
| Codex/OpenCode/Mock Adapter 及其测试 | 解析结构化结果并发出合法 AgentEvent，保留固定 Reviewer 回退 |
| `apps/web/app/dashboard.tsx` 及相关测试/样式 | 中性 Handoff 文案和既有单屏投影展示，不新增工作流编辑器 |
| `README.md`、`docs/05-roadmap.md`、`docs/07-implementation-status.md`、`docs/09-overall-design-baseline.md`、ADR-017 | 仅同步实际实现和验证事实 |

禁止修改 `packages/db/src/schema.ts`、`packages/db/drizzle/`、Docker/Redis/BullMQ 拓扑和无关功能模块。若确有必要，先标记 `BLOCKED`。

## 8. 合约、状态与数据影响

### Contracts

非 Review Agent 的最终输出允许包含一个 RelayHub 结构化结果，语义至少覆盖：

```json
{
  "summary": "本 Run 完成了什么",
  "nextAction": {
    "type": "handoff",
    "targetAgentId": "平台提供的 AgentProfile UUID",
    "reason": "为什么由该 Agent 接手"
  },
  "handoff": {
    "objective": "目标 Agent 要完成什么",
    "summary": "无隐藏推理的上下文摘要",
    "artifactRefs": [],
    "evidenceRefs": [],
    "decisions": [],
    "openQuestions": [],
    "risks": []
  }
}
```

- 具体 envelope 标记可以由 Developer 统一设计，但必须是显式边界、严格 Schema 校验，并能从普通自然语言中无歧义提取。
- 当 `nextAction.type=handoff` 时必须存在 Handoff 内容；目标必须一致。
- 当 `nextAction.type=request_review` 时仍走 Task 固定 Reviewer 规则。
- 当前未返回通用结构化结果的 Builder 保持兼容：有 Reviewer 时继续自动请求现有 Reviewer；无 Reviewer 时继续 `wait_for_user`。
- Reviewer 的既有 `<relayhub_review>` 合约不改变。

### State transitions

```text
来源非 Review Run running
-> handoff.requested(pending)
-> 来源 Run succeeded
-> Handoff dispatched + 目标 Run queued(trigger=handoff)
-> Task 继续 running，currentRunId 指向目标 Run
-> 目标 Run claim + handoff.consumed
-> 目标 Agent 独立执行并提出下一 Route
```

预算耗尽：

```text
来源 Run succeeded
-> Handoff rejected(reason=handoff_budget_exhausted)
-> 不创建目标 Run
-> Task waiting_for_user
```

固定 Reviewer 路径保持：

```text
request_review
-> Task reviewing
-> triggerType=review
-> Review/Finding/repair/CompletionPolicy
```

### Database / migration

- 预期无 migration。
- 复用 `handoffs.next_action`、`handoffs.status=rejected`、`runs.parent_run_id`、`runs.trigger_type=handoff` 和现有 Event/Outbox。
- 交接次数通过当前 Task 的 Handoff facts 查询，不新增重复计数真相源。

### Backward compatibility

- 历史 Handoff v1/v2、固定 Reviewer Task 和旧 RunOutcome 继续可读。
- 未输出新 envelope 的真实 CLI 仍走当前固定 Reviewer/等待用户回退。
- 公共 Task/Run API 不暴露新的敏感 AgentProfile 信息。
- 现有 Mock Builder → Mock/Codex Reviewer、changes_requested repair 和用户确认测试必须继续通过。

## 9. 实现边界

建议按以下架构接缝推进，不要求照抄函数拆分：

1. 先在 contracts 定义严格的结构化非 Review 结果和最小候选 Agent view，并完成解析测试。
2. 让 run claim 返回同 Workspace 的最小候选目录；Prompt 只展示允许路由的信息。
3. 在 Worker 统一解析 Agent 结果，再由 Adapter 生成 `handoff.requested` 和 `run.completed`，避免三个 Adapter 各自发明协议。
4. 在 Orchestrator/Repository 中先区分 `handoff` 与 `request_review`，再在一个事务中完成目标校验、Run snapshot、Handoff 状态、Task currentRun、Event 和 Outbox。
5. 更新只读 Coordination 投影和中性 UI 文案。
6. 最后做隔离 PostgreSQL 端到端链、浏览器链和真实 CLI 冒烟。

不要把目标 Agent 的选择写死成名称，也不要引入每种专业 Agent 的 switch/case。

## 10. 验收标准

### 功能行为

- [ ] Mock Agent A 能通过结构化 `handoff` 把同一 Task 顺序交给 Mock Agent B；B 获得独立 Run、Profile snapshot、Token 和完整 Handoff V2。
- [ ] A 完成后只有一个 B Run 被创建，Task 保持 `running`，`currentRunId` 指向 B，A/B 的 parent/trigger/agent identity 可从数据库重建。
- [ ] B claim 后校验 digest 并提交 `handoff.consumed`；Handoff 从 `dispatched` 变为 `accepted`。
- [ ] B 可以继续 handoff 给 C，或通过 `request_review` 进入 Task 固定 Reviewer；两种 Route 语义和 triggerType 不混淆。
- [ ] 通用 Handoff Agent 没有 Review authority；只有正式 Reviewer Run 能提交 Review。
- [ ] 旧 Builder 未返回新结构化结果时，固定 Reviewer/等待用户行为不回归。
- [ ] Web 单屏能显示通用目标 Agent、Handoff 状态、当前 Owner 和下一 Route，不把所有交接都写成 Reviewer。

### 越权与异常路径

- [ ] 未知、禁用、跨 Workspace、自身目标、目标不一致和历史/非当前 Run 的 Handoff 均被确定性拒绝，且不创建目标 Run 或 Outbox。
- [ ] CLI 内部子 Agent 无法伪造平台 AgentProfile；任意字符串名称或内部 session id 不能成为合法 `targetAgentId`。
- [ ] 目标在 pending 与来源完成之间被禁用时，不派发目标 Run，Task 不悬空并转交用户处理。
- [ ] 重复 `handoff.requested`、重复 `run.completed`、重复 Outbox publish 不产生第二个目标 Run。
- [ ] 第 7 次通用 handoff 不创建 Run，Handoff 为 `rejected`，Task 为 `waiting_for_user`，原因可查询。
- [ ] Handoff digest 被篡改、目标 Run 不匹配或消费元数据不匹配时继续拒绝。
- [ ] 候选目录和所有公共输出中不存在 credential env value、Provider secret、其他 Agent instructions、SessionRef、Run Token 或隐藏 reasoning。

### 自动化与集成

- [ ] Contracts 覆盖合法/非法结构化结果、目标一致性和兼容回退。
- [ ] Worker 覆盖 Codex、OpenCode、Mock 的通用 Handoff、固定 Review 回退、Malformed envelope 和权限边界。
- [ ] API 使用全新隔离 PostgreSQL 覆盖 A → B → C、A → Reviewer、预算耗尽、目标失效、重复事件和摘要校验。
- [ ] `TaskCoordinationView` 覆盖 generic handoff pending/dispatched/accepted、目标 Agent owner 和 review route。
- [ ] `pnpm check` 全部通过。

### 真实运行与 UX

- [ ] 从 Web 创建或配置两个名称不同的平台 AgentProfile，能够在 Timeline 区分来源与目标身份。
- [ ] 浏览器验证 loading、运行中、handoff pending、目标执行、waiting_for_user/Review 和错误状态；窄视口无页面级溢出，控制台无新增错误。
- [ ] 如果本机已有有效 CLI/Provider 凭证，完成一次真实 Agent A → Agent B 顺序交接，并保留 Task/Run/Handoff/Event ID、命令证据和只读数据库核对。
- [ ] 如果真实凭证或 CLI 缺失，Work Item 标记 `BLOCKED` 并写明探测证据；不能仅凭 Mock 将真实 CLI 验收写成通过。

## 11. 必须执行的验证

```bash
git diff --check
pnpm check
```

API 集成测试必须使用全新隔离数据库，例如由 Implementer 创建专用临时 PostgreSQL database，并以专用变量传入：

```bash
TEST_DATABASE_URL="$RELAY_HUB_WORK_ITEM_DATABASE_URL" pnpm --filter @relay-hub/api test
```

要求：

- `$RELAY_HUB_WORK_ITEM_DATABASE_URL` 不能指向 RelayHub 正式数据库。
- 不得 flush Redis、删除 Docker volume 或清理用户现有 Task/Run/Handoff。
- 浏览器验收使用本 Work Item 的专用测试 Task/Agent 名称，完成后保留审计记录。
- 真实 CLI 验收前只做只读的版本、登录状态和模型可用性检查，不在文档中记录密钥值。

## 12. 风险与回滚

### Risks

- 模型返回结构化结果不稳定，可能造成 protocol error；必须有严格 parser、清晰 Prompt 和旧固定路径回退。
- 目标选择过于自由可能形成乒乓循环；固定 6 次预算和唯一 current Run 是本切片的硬边界。
- 泛化现有 Reviewer 代码可能误放宽 Review authority；`triggerType=review` 校验必须继续作为最终守卫。
- 多个 Agent 顺序写同一 Worktree 可能覆盖意图；Handoff 的 decisions/openQuestions/risks 和完整 Timeline 必须保留责任链。
- 候选 Agent 目录可能泄露配置；仅允许最小公开字段。

### Rollback

- 实现应以兼容分支扩展现有 `request_review`，不改写历史数据。
- 出现问题时可停用通用 `handoff` 路由并保留固定 Builder → Reviewer 路径；已有 Handoff/Run/Event 不删除。
- 不回滚或删除 migration，因为本 Work Item 不应创建 migration。
- 回滚后 pending 通用 Handoff 必须可解释地转为 `rejected` 或 `waiting_for_user`，不能遗留无法领取的 queued Run。

## 13. Delivery Report

由 Developer 在标记 `SUBMITTED` 前填写。

### 实现摘要

### 修改文件与职责

### 与任务包的差异

### 验证命令与结果

### 数据、配置与兼容性

### 已知风险

### Git evidence

- Branch:
- Commit:
- Push:
- Worktree status:

## 14. Acceptance Report

由 Architect 在 `VERIFYING` 阶段填写。

### 验收基线

### 自动化验证

### 集成 / 浏览器 / 真实运行验证

### Findings

| Severity | Finding | Resolution |
|---|---|---|
| | | |

### Verdict

- Status: `CHANGES_REQUESTED` / `ACCEPTED`
- Reason:

## 15. Closure

由 Architect 在集成后填写。

- Final status: `DONE`
- Main commit:
- Push result:
- Final verification:
- Documentation updated:
- Closed at:
