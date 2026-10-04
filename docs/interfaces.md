# 已核实的 DSH 接口（2026-10-04）

本机 `dsh --version` 为 `0.2.0-rc.2`。可点击的官方源码固定到 [`5badb15009ae1756c3afe0ae0cef1faafc290ccc`](https://github.com/deepseek-ai/deepseek-harness/tree/5badb15009ae1756c3afe0ae0cef1faafc290ccc)。实际 ASAR 声明的构建提交为 `04f392c9ddd144fa426da2045178797da6db6c11`，其公开 Contents API 返回 404；**两个提交不同**，不能把公开参考树当成安装包逐字相同的源码。本次另外只读解析了已安装 ASAR，并用桌面自带 CLI 和真实 Loader 交叉验证接口。普通文件工具无法把 ASAR 虚拟子路径当真实目录列出。

## 直接复用

- [Cordis 插件入门](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/cordis-tutorial/01-first-plugin.md)：命名导出 `apply(ctx, config)`，`inject` 表达服务依赖。
- [headless runner](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/bundle/headless/src/index.ts)：一次性独立 agent，真实 Session、工具与模型调用；恢复要求相同 cwd、存在的 root Session，不将任意 typo 当新会话。
- [headless overlay](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/bundle/headless/cordis.patch.yml)：`dsh headless --patch PATH --json`；任务 `-` 从 stdin 读取，续跑 `--session-id ID`。
- [NDJSON 源码](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/bundle/headless/src/json-stream.ts)：开头 `type=session,sessionId,cwd`；结尾 `type=status,phase=turn_end,reason={kind:completed}` 与 `type=final,text`。同时检查进程退出码，不只看最后一行文字。
- [Session 文档](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/subsystems/session.md)、[真实模型续跑测试](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/cli/tests/profiles/headless/tests/resume.e2e.ts)：DSH 的 append-only 会话 / 持久化及恢复，不在本项目重新实现。

## 桌面 bundle 与工具契约

- [bundle 解析](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/app-boot/src/profile.ts)：包根声明 `dsh.bundle.patch`，YAML 用 `- insert:` 插入独立 Host 入口。仅导出 receipt 插件或 CLI bin 不够。
- [defineTool 契约](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/cookbook/adding-a-tool.md)：`ctx.tools.register(defineTool(...))`；参数使用 DSH 的 `parameters` DSL，结果声明 `output.schema/render`，执行接收 `exec.signal`，注册随 fiber 销毁而移除。
- [官方权限门](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/tools.ts#L37-L44)：从 `@deepseek-ai/dsh-sandbox` 导入 `approveEscalation`，配合 `sandboxPolicy.resolve` 和可选 approval 服务。Host 原生 I/O 不会因为注册成工具而自动受工作区沙箱保护。
- [工作目录来源](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/shell/tool-bash/src/index.ts#L145-L162)：policy workspace / `exec.agent.session.header.cwd`，不得采用插件安装 cwd 或全局 `process.chdir()`。
- [插件管理器 UI](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-plugin-manager/README.md) 与 [安装 spec](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/install-spec.ts)：安装与启用分开；固定 GitHub tag/SHA、绝对本地路径和 tarball 是有效来源。
- [桌面自带 CLI](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/desktop/README.md#bundled-command-runtime)：先完全退出 desktop，再用其自带 CLI 的 `plugin --profile desktop add/list/remove`；这不授权用 CLI boot/dump desktop。
- [协议处理](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/desktop/src/main.ts#L1228-L1232)：本版只处理打开/聚焦用途的 `dsh://open`，未发现可用的安装深链。

隔离验收采用实际 launcher 的 `DSH_HOME` 与 `--from-default-profile headless --dump-config`，不是不存在的 `--home` 或 bare 模板。禁用测试 profile 的 `headless-startup/headless-runner` 后，在 `appReady` 检查 `ctx.tools.get('github_harness')`，再通过 `appExit` 有界退出；没有启动模型来“猜工具是否存在”。具体验证记录归档在[独立演示仓库](https://github.com/yintaocheng/dsh-github-harness-demo/tree/main/evidence)。

## GitHub 官方示例的边界

读过 [GitHub review 指南](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/user/guide/github-review.md)、[overlay](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/cli/config/examples/github-review/cordis.yml) 和 [rule](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/apps/cli/config/examples/github-review/github-ready-review-rule.mjs)。

该示例以签名 webhook 创建只读 review Session，`202` 只代表接收，并非 agent 已完成；运行时不持久化 delivery/执行状态，重复 delivery 可能创建另一会话。webhook secret 不授予 outbound GitHub 权限。所以首版不直接用它来假装具备任务去重或 PR 发布能力。

另外检查了 [plugin-manager GitHub connection](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/boot/plugin-manager/src/github-connection.ts)：这是安装器连接检查，不是可复用的 Issue/PR 业务接口。

## 本项目新增

[薄 Cordis 插件](../src/plugin.mjs) 只用和官方 NDJSON 投影相同的 `ctx.on('session/event', ...)` seam，在 turn/start、turn/end 写出任务/session receipt；不调用未核实的私有 Web API。外层 [CLI](../src/cli.mjs) 使用 GitHub 官方 REST / Git 连接公共事实与 DSH。这样现在可以运行，将来需要改消息 / 上下文策略时仍有正式插件接入点。

模型与账号配置属于宿主或目标项目的本地设置，不属于插件分发包。具体模型调用和历史环境问题记录在[演示证据](https://github.com/yintaocheng/dsh-github-harness-demo/tree/main/evidence)中，不能将某台机器的可用路由当作所有用户的默认配置。
