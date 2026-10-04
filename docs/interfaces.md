# 已核实的 DSH 接口（2026-10-04）

本机 `dsh --version` 为 `0.2.0-rc.2`。官方仓库研究固定到 commit [`5badb15009ae1756c3afe0ae0cef1faafc290ccc`](https://github.com/deepseek-ai/deepseek-harness/tree/5badb15009ae1756c3afe0ae0cef1faafc290ccc)，不是凭记忆假设 SDK。安装包在 Electron ASAR 中，普通文件工具无法把它当真实目录列出；本次阅读官方源码，并用已安装 CLI 验证协议。

## 直接复用

- [Cordis 插件入门](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/cordis-tutorial/01-first-plugin.md)：命名导出 `apply(ctx, config)`，`inject` 表达服务依赖。
- [headless runner](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/bundle/headless/src/index.ts)：一次性独立 agent，真实 Session、工具与模型调用；恢复要求相同 cwd、存在的 root Session，不将任意 typo 当新会话。
- [headless overlay](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/bundle/headless/cordis.patch.yml)：`dsh headless --patch PATH --json`；任务 `-` 从 stdin 读取，续跑 `--session-id ID`。
- [NDJSON 源码](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/bundle/headless/src/json-stream.ts)：开头 `type=session,sessionId,cwd`；结尾 `type=status,phase=turn_end,reason={kind:completed}` 与 `type=final,text`。同时检查进程退出码，不只看最后一行文字。
- [Session 文档](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/subsystems/session.md)、[真实模型续跑测试](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/cli/tests/profiles/headless/tests/resume.e2e.ts)：DSH 的 append-only 会话 / 持久化及恢复，不在本项目重新实现。

## GitHub 官方示例的边界

读过 [GitHub review 指南](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/user/guide/github-review.md)、[overlay](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/cli/config/examples/github-review/cordis.yml) 和 [rule](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/cli/config/examples/github-review/github-ready-review-rule.mjs)。

该示例以签名 webhook 创建只读 review Session，`202` 只代表接收，并非 agent 已完成；运行时不持久化 delivery/执行状态，重复 delivery 可能创建另一会话。webhook secret 不授予 outbound GitHub 权限。所以首版不直接用它来假装具备任务去重或 PR 发布能力。

另外检查了 [plugin-manager GitHub connection](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/github-connection.ts)：这是安装器连接检查，不是可复用的 Issue/PR 业务接口。

## 本项目新增

[薄 Cordis 插件](../src/plugin.mjs) 只用和官方 NDJSON 投影相同的 `ctx.on('session/event', ...)` seam，在 turn/start、turn/end 写出任务/session receipt；不调用未核实的私有 Web API。外层 [CLI](../src/cli.mjs) 使用 GitHub 官方 REST / Git 连接公共事实与 DSH。这样现在可以运行，将来需要改消息 / 上下文策略时仍有正式插件接入点。

本机首次 headless smoke 默认 DeepSeek route 返回 401（未记录密钥），随后以独立本地 overlay 复用现有 desktop 的 `cliproxyapi / gpt-6-astra` 路由和 `CLIPROXYAPI_API_KEY` 凭据引用；真实独立 headless 成功返回 `HARNESS_SMOKE_OK`。没有修改全局桌面配置，也没有把凭据值加入项目。
