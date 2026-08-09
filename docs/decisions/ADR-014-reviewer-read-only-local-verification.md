# ADR-014：Reviewer 代码只读与本地验证权限分离

## 状态

Accepted / Implemented（2026-08-09）

## 背景

Reviewer 需要独立复跑测试，而不是只相信 Builder 的摘要和命令证据。Codex 的传统 `read-only` sandbox 同时禁止文件写入和网络监听，导致会在 `127.0.0.1` 启动临时 HTTP 服务的测试以 `listen EPERM` 失败。直接切换到 `workspace-write` 又会破坏 Reviewer 不能修改 Builder 产物的边界。

## 决策

1. Reviewer 继续复用 Builder Worktree，但该 Worktree 对 Reviewer 保持只读；Reviewer 不创建第二个写入分支，也不运行写入型 Bootstrap。
2. Codex Reviewer 不再使用把文件与网络捆绑在一起的传统 `--sandbox read-only`，改用 RelayHub 每次 Run 注入的命名 permission profile。
3. permission profile 继承 Codex `:read-only` 文件权限，只额外启用 sandboxed network 和 `allow_local_binding`。
4. 网络代理只允许 `localhost` 与 `127.0.0.1`；Reviewer 不应绑定 `0.0.0.0`、局域网地址或访问无关本地服务，也不获得通用外部网络权限。
5. CLI 使用 `--ignore-user-config`、`--strict-config` 和 `approval_policy="never"`。因此权限来自不可变 Run Adapter 策略，不依赖用户级 Codex 配置；不支持该 profile 的 CLI 必须显式失败，不能静默降级为可写执行。
6. Reviewer Prompt 明确允许运行本地验证命令和仅绑定回环地址的临时服务，同时继续禁止修改文件、提交和推送。

## 结果

- Reviewer 可以独立运行 HTTP、WebSocket 等需要回环监听的本地测试。
- Builder 代码仍由操作系统 sandbox 强制只读，模型提示词不是唯一防线。
- Reviewer 的本地服务不会暴露到非回环接口，外部网络也不因测试权限而开放。
- Builder 与 repair Run 继续使用原有 `workspace-write` 策略，不受 Reviewer profile 影响。
