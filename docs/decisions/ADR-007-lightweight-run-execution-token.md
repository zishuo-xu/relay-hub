# ADR-007：使用轻量单次 Run execution token 保护 Worker 回调

- 状态：Implemented
- 日期：2026-08-06

## 背景

Queue 的重复投递由 PostgreSQL 原子 claim 解决，但 claim 成功后的 control/event 接口仍无法区分当前 Worker、旧 Worker 和误指向其他 Run 的进程。RelayHub 是单用户本地优先项目，现阶段不需要用户登录、RBAC、OAuth 或完整内部 PKI，但需要让每次执行具有独立且可撤销的身份。

## 决策

1. API 只在 `queued -> claimed` 原子更新成功时签发一次 `rht_` 前缀、256-bit 随机不透明 Token。
2. 数据库仅保存 SHA-256 哈希、签发时间、过期时间和撤销时间；明文只存在于 claim 响应和 Worker 进程内存。
3. control/event 接口使用 Bearer Token，并同时校验 Run ID 绑定、哈希、有效期、撤销时间和非终态状态。
4. `ClaimedExecution` 将 `ClaimedRun` 与 `executionToken` 分开；AgentAdapter 只接收前者，凭证不进入 Agent、Prompt、Event、日志 payload 或公有 API。
5. 默认有效期为 2 小时，可通过环境变量调整；Run 成功、失败或取消时在终态事务中立即撤销。
6. 不引入 JWT，因为当前不需要可携带声明、跨服务离线验签或密钥轮换体系。服务端数据库查询正好同时完成 Run 状态和撤销检查。
7. claim 接口暂时保留在单机内部信任边界。Worker 注册认证、lease、heartbeat、续期和崩溃 reconciliation 作为后续同一可靠性切片实现。

## 结果

- 错误进程、跨 Run Token、旧 Worker 和终态后的回调不能继续污染执行记录。
- 新增 AgentAdapter 或模型供应商不需要理解平台凭证。
- 架构保持轻量；代价是当前 Token 到期不会自动续期，超长 Run 需要后续 heartbeat 续期能力。
