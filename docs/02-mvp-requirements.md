# 02. MVP 需求与验收标准

## 核心用户故事

作为一个同时使用多个编程 Agent 的开发者，我希望提交一个任务，让实现 Agent 完成工作，再自动交给审查 Agent 给出结论，并且我能实时看到整个过程、取消异常执行以及追溯所有状态变化。

## 标准演示场景

1. 用户创建 Workspace，并登记 `builder` 与 `reviewer` 两个 Agent。
2. 用户创建“为示例服务增加健康检查接口”的 Task。
3. 平台创建 builder Run，将其放入队列。
4. Worker 执行 Agent，前端实时展示文本和工具事件。
5. builder 完成后提交 Handoff，其中包含结果摘要、变更文件和待检查事项。
6. 平台创建 reviewer Run；reviewer 输出结构化 Review。
7. 无阻塞问题时 Task 进入 `completed`；存在阻塞问题时进入 `changes_requested`。
8. 用户可在 Timeline 中查看完整执行链和失败原因。

## 功能需求

### FR-1 Workspace

- 创建和查询 Workspace。
- 为 Workspace 指定允许操作的本地目录。
- Agent 运行不得写出该目录。

### FR-2 Agent Profile

- 配置 Agent 名称、Adapter 类型、模型标签和能力标签。
- 启用、停用和健康检查 Agent。
- 密钥只通过环境变量引用，不保存明文。

### FR-3 Task

- 创建 Task，至少包含标题、需求描述、目标 Agent 和验收标准。
- 查询 Task 当前状态与执行时间线。
- 支持取消、重新执行和人工关闭。

### FR-4 Run

- 每次 Agent 执行产生唯一 Run。
- Run 保存尝试次数、父 Run、触发原因、开始/结束时间和结构化错误。
- 同一 Agent 在同一 Workspace 默认只允许一个 Run 运行。

### FR-5 实时事件

- 前端按 Task 订阅事件。
- 支持输出增量、工具调用、状态迁移和错误事件。
- 断线重连后能从最后事件 ID 补拉，不重复展示。

### FR-6 Handoff

- 运行中的 Agent 可以请求把任务交给另一个 Agent。
- Handoff 必须包含目标、摘要、产物引用和验收要求。
- 平台校验目标 Agent 后创建子 Run；不能仅解析自然语言中的 `@name` 来执行。

### FR-7 Review

- Reviewer 输出 `approved`、`changes_requested` 或 `blocked`。
- Finding 包含严重级别、位置、问题和建议。
- Review 结论驱动 Task 状态，但完成策略可配置为自动完成、用户确认或风险路由。
- 用户始终可以进行人工裁决并留下原因。

### FR-7.1 Completion Policy

Workspace 提供默认完成策略，Task 创建时可以覆盖：

- `auto_on_approval`：Reviewer approved 后自动完成。
- `require_user_confirmation`：Reviewer approved 后进入等待用户确认。
- `risk_based`：低风险自动完成；命中配置风险条件时等待用户确认。

无论使用哪种策略，Review、策略判定和最终完成人都必须进入审计事件。

### FR-8 失败与取消

- 用户可以取消 queued 或 running 的 Run。
- 可重试错误最多自动重试一次；协议错误默认不自动重试。
- Worker 重启后能够识别并收敛遗留的 running Run。

### FR-9 审计

- 所有命令、状态变化、交接和人工裁决都写入不可变事件表。
- 日志不得记录密钥和完整环境变量。

## 非功能需求

| 维度 | MVP 指标 |
|---|---|
| 可恢复性 | 浏览器重连后可恢复完整时间线 |
| 一致性 | Task 和 Run 不出现非法状态迁移 |
| 幂等性 | 重复提交相同命令不会创建重复 Run |
| 响应性 | 持久事件产生后 1 秒内展示到本地前端 |
| 安全性 | 工作目录白名单；参数数组启动子进程；敏感信息脱敏 |
| 可测试性 | 状态机、Adapter 解析和幂等路径具备单元/集成测试 |
| 可演示性 | 无外部账号时可使用 Mock Adapter 走通全流程 |

## 状态模型

### Task 状态

```text
draft -> queued -> running -> reviewing -> completed
                         \-> changes_requested -> running
            \-> cancelled
            \-> failed
```

### Run 状态

```text
queued -> claimed -> starting -> running -> succeeded
                                  |  \-> failed
                                  \----> cancelling -> cancelled
```

终态为 `succeeded`、`failed`、`cancelled`。终态 Run 不允许再次迁移；重试必须创建新 Run。

## MVP 验收标准

- [ ] 在 Mock Adapter 下，演示场景可重复运行且结果确定。
- [ ] 至少一个真实 CLI Adapter 能流式返回文本。
- [ ] builder 到 reviewer 的交接形成可查询父子 Run。
- [ ] WebSocket 断线后刷新页面，Timeline 不丢事件、不重复事件。
- [ ] 重复发送带相同 idempotency key 的创建命令，只生成一个资源。
- [ ] running 进程被取消后，Run 最终进入 `cancelled`，子进程被回收。
- [ ] Worker 异常退出后，遗留 Run 能在恢复流程中进入可解释状态。
- [ ] Review finding 可在 UI 中定位并按严重级别展示。
- [ ] 自动化测试覆盖全部允许和禁止的状态迁移。

## 非目标测试

以下情况不会阻塞 MVP：

- 多机器水平扩展。
- 超过两个真实 Agent 同时运行。
- 语义搜索与向量检索。
- 企业级 RBAC、SSO 或配额计费。
- 移动端和桌面客户端。
