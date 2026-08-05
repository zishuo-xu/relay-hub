# ADR-004：本地优先与可配置审查完成策略

- 状态：Accepted
- 日期：2026-08-06

## 背景

整体基线需要确定第一版用户范围、Builder/Reviewer 与模型的关系，以及 Reviewer approved 后是否自动完成 Task。这些选择会影响身份模型、配置结构、Task 状态机和用户体验。

## 决策

### 单用户、本地优先

1. 第一版服务一个人类 Operator，不实现注册、团队成员、RBAC、租户计费和企业账号。
2. Web、API、Worker、PostgreSQL 和 Redis 默认运行在本地或用户控制的开发环境。
3. 数据模型保留 Workspace ownership 边界，为未来扩展留出空间。
4. 单用户不限制 Agent、模型、Workspace 或并发 Task 数量。

### Provider-neutral Agent role

1. Builder 和 Reviewer 是工作流角色，不绑定 Codex、Claude 或其他供应商。
2. 每个角色由 AgentProfile 选择 Adapter、provider、model 和 tool policy。
3. Reviewer 必须使用不同 AgentProfile。
4. 不同 model family 默认优先，但允许配置 fallback 行为。

### Configurable completion

1. `CompletionPolicy` 支持 `auto_on_approval`、`require_user_confirmation` 和 `risk_based`。
2. 第一版默认 `require_user_confirmation`。
3. Workspace 提供默认值，Task 可以覆盖。
4. `risk_based` 只能依据明确、可测试的风险条件，不能让模型自由决定是否需要审批。
5. Review 结论、策略判定和最终完成动作都写入审计事件。

## 结果

- 第一版避免被多用户权限系统分散精力，同时保留未来扩展边界。
- 跨模型 Review 是可配置能力，不成为缺少第二模型时的硬故障点。
- 默认用户确认提供安全起点；积累运行证据后可切换风险路由或自动完成。

