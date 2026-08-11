# WI-<阶段>-<序号>-<slug>：<标题>

## Metadata

- Status: `DRAFT`
- Architect:
- Implementer:
- Baseline commit:
- Topic branch:
- Revision: 1
- Created at:
- Updated at:

## 1. 用户价值与目标

说明完成后用户获得什么，以及为什么现在做。

## 2. 当前系统事实

列出开发者可以依赖的已实现行为、相关 ADR、接口和限制。

## 3. In scope

- 

## 4. Out of scope

- 

## 5. 架构不变量与禁止事项

- 

## 6. 决策边界与开发者自主权

### Architect 已冻结的决定

- 产品目标、架构边界、对外合约和验收标准。

### Developer 可自主决定

- 约束范围内的内部拆分、算法、辅助抽象、测试组织和重构方式。

### 必须标记 `BLOCKED` 的情况

- 需要改变目标、架构不变量、对外合约、数据所有权、安全边界或允许修改范围。

## 7. 允许修改的模块

| 模块 | 允许的修改 |
|---|---|
| | |

## 8. 合约、状态与数据影响

### Contracts

### State transitions

### Database / migration

### Backward compatibility

## 9. 实现边界

只描述必须遵循的架构接缝、兼容要求和推荐顺序，不替开发者规定完整实现。

## 10. 验收标准

- [ ] 功能行为
- [ ] 错误和异常路径
- [ ] 自动化测试
- [ ] 集成或真实运行
- [ ] 文档与 Git

## 11. 必须执行的验证

```bash
pnpm check
```

补充本 Work Item 特有的命令、隔离环境和浏览器路径。

## 12. 风险与回滚

### Risks

### Rollback

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
