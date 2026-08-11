# RelayHub Work Items

本目录保留重大特性的设计、范围与验收证据。日常小型变更不强制创建 Work Item；工作规则见 [`../10-autonomous-development-workflow.md`](../10-autonomous-development-workflow.md)。

## Active

| ID | 标题 | 状态 | Work Item |
|---|---|---|---|
| - | 当前无活跃 Work Item | - | - |

## Recently completed

| ID | 标题 | 最终 main commit | Work Item |
|---|---|---|---|
| `WI-P3.4-001` | 顺序型平台 Agent 动态 Handoff | `DONE` | [`WI-P3.4-001-sequential-agent-handoff.md`](WI-P3.4-001-sequential-agent-handoff.md) |

## 维护规则

- Active 最多只有一个主要 Work Item，避免多个大型半成品并行推进。
- Codex 统一承担设计、实现、验证、文档和关闭责任。
- 只有大型、高风险或跨会话特性需要在此登记；小型修复直接按自主交付闭环完成。
- 状态变化时同时更新登记表和 Work Item 文件。
- 登记表只保存索引；完整范围、证据、Findings 和验收结论保存在对应 Work Item。
- `DONE` 后从 Active 移入 Recently completed，保留审计记录。
- 不删除已完成或取消的 Work Item。
- 未排期的想法留在路线图或候选列表，不占用 Active 计划槽位。
