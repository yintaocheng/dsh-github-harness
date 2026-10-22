# DSH 接口与验证依据

[← README](../README.md) · [用户升级指南](compatibility.md)

## 版本和证据边界

2026-10-22 核对并分别验证 DSH `0.2.0-rc.2` 与 `0.2.1-rc.2`。前者使用桌面自带 CLI，后者使用官方 npm 的明确版本；实际安装和 Loader 调用在独立 `DSH_HOME` / profile 中完成，不启动运行中的 desktop profile。

本页源码链接固定到官方 [`dsh-v0.2.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2)。公开源码标签用于解释契约，不能代替安装产物的运行验证，也不证明与桌面安装包逐字相同。历史 `0.2.0-rc.2` 桌面 ASAR 曾声明构建 `04f392c9ddd144fa426da2045178797da6db6c11`，与当时公开参考提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc` 不同；不将两者混为一谈。

## Host 工具契约

- [Cordis 插件](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/cordis-tutorial/01-first-plugin.md)：命名导出 `apply(ctx, config)`；`inject` 声明依赖。本插件必需 `tools`、`sandboxPolicy`，按调用取得可选 approval 服务。
- [工具 schema](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/core/tools/src/schema.ts)：使用 `defineTool` 的属性映射 DSL，每个必需参数声明 `required: true`；不是把完整 object JSON Schema 塞进 `parameters`。
- [工具运行时](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/core/tools/src/index.ts)：注册 `ctx.tools.register(...)`，声明 `output.schema/render`。执行函数返回声明的规范值；本插件返回 JSON 字符串，不返回旧式 `{content: [...]}` 包装。真实 native 与 PTC 调度均验证该契约。
- [生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/cordis-tutorial/02-lifecycle-and-effects.md)：注册随 fiber 回收，异步 disposer 可并行。插件自行中止并等待正在执行的调用，而不只移除工具名。
- [审批](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/sandbox/sandbox/src/escalation.ts)：使用 `approveEscalation` 与 `sandboxPolicy.resolve`。Host 原生 I/O 不会自动获得文件沙箱保护，因此在配置读取、凭据查找和执行之前检查授权。只读 / workspace-write 且不允许审批时拒绝。

`0.2.1` 的新执行目录服务见[工作目录迁移说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/upgrade-guide/v0.2.1-alpha.1/working-directory/guide.md)。本插件刻意保留工作区相对 `workdir`：policy workspace 优先，否则使用原始 session cwd；不跟随 `workingDirectory.get(session)` 的变化，不修改沙箱根，也不调用全局 `process.chdir()`。

## headless 与根会话

使用[官方 headless runner](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/bundle/headless/src/index.ts)，不另外实现 agent 或会话存储：

```text
dsh headless --patch PATH --json [--session-id ID] -
```

任务从 stdin 读取。[NDJSON 投影](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/bundle/headless/src/json-stream.ts)包含开头的 `sessionId/cwd`、终端 `status/turn_end` 及 `final/text`。进程退出码、完成原因、数据格式和根身份共同决定成功；出现 final 文本不代表可以发布。

DSH 的续跑要求原始工作目录、存在且可恢复的根会话与持久化服务；子会话、fork、预设会话或错误 ID 不能静默当成新会话。新 runner 也会等待子任务稳定，并跟踪尚未被后续持久化终端事件清除的 agent 错误。

[receipt 插件](../src/plugin.mjs)仅订阅 `session/event`：忽略子 / fork 会话和其他目录，固定期望或首次观察到的根 ID，并写入当前调用的随机 `runId`。外层[执行器](../src/dsh.mjs)交叉检查 receipt、NDJSON 身份、目录与退出状态；成功输出尚未通过交叉检查时，不把新 ID 保存为任务身份。

[统一接纳规则](../src/session-receipt.mjs)同时用于执行器和重启后的本地任务发现。现代 receipt 必须标记 `root: true`，并匹配同一 `runId` 命名的实际 stdout 开头；进程日志独占创建，不能覆盖旧证据。被拒绝的新观察会持久标记，下一次启动仍拒绝。旧格式不带这些字段，因此只有与独立记录的既有身份相符才可迁移；receipt-only 旧记录只保留工件别名，等待可信检查点或人工核对。

## 兼容声明与安装

[新版兼容检查器](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/boot/app-boot/src/plugin-compatibility.ts)优先使用 `engines.dsh`，缺少它时才按 SDK peers 回退。本包的 engines、四个 SDK peer 范围与[运行前预检](../src/compatibility.mjs)使用相同的精确版本清单；optional peers 只避免纯 CLI 安装强制下载宿主，不豁免 Host 兼容检查。

[包清单](../package.json)通过 `dsh.bundle.patch` 插入独立 [Host 入口](../src/desktop-plugin.mjs)。官方插件管理器支持固定 GitHub tag、绝对目录与 tarball；安装和启用不是同一步。更换已加载的包后按宿主提示重启，不以临时副本覆盖运行中的 desktop profile。

隔离验收只对**确认不存在的全新 profile**使用一次 `--from-default-profile`。在 `0.2.1`，该选项会[替换已有 profile](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/upgrade-guide/v0.2.1-alpha.2/from-default-profile-replaces-target/guide.md)，不能在每次探测或升级时重复调用。插件安装命令的 pnpm 参数转发也有版本区别：`0.2.1` 直接接受 add 后的选项，不要额外插入 `--`，否则选项可能被当成包名。用户安装优先遵循[桌面步骤](desktop.md)。

## 不复用的边界

GitHub webhook review 示例不是持久化任务调度器，安装器的 GitHub 连接检查也不是 Issue/PR 业务 API。本插件直接使用 GitHub 官方 REST 与 Git，独立管理任务去重、候选树验证和发布恢复，不调用未核实的私有 Web API。

模型凭据和 provider 路由仍属于用户本地配置，不进入发布包。实际运行证据与个别任务测试数放在[独立演示项目](https://github.com/yintaocheng/dsh-github-harness-demo)，不将某台机器的模型配置当作通用默认值。
