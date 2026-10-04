# dsh-github-harness

**把目标仓库中的一个 GitHub Issue 交给 DSH：修改代码、运行验收、提交一个供人审查的 PR。**

这是面向 **DeepSeek Harness 0.2.0-rc.2** 的社区插件，使用官方 bundle / Host 工具接口，不是 DeepSeek 官方出品。插件安装位置与目标仓库相互独立：不必 Fork 本插件，也不必把插件源码复制进自己的项目。

```text
项目仓库中的 Issue → 单 agent → 修改与独立验收 → PR + 检查点
        ↑                                      │
        └────────── 新反馈，续跑同一任务 ─────────┘
```

**一次 `run` 绑定一个目标仓库中的一个任务。** 同一插件可以服务多个项目，每个项目可以有多项任务；任务身份不绑定执行者名称。当前手动启动、单执行者运行，**不自动合并**。

## 在官方插件管理器安装

桌面侧栏 **Plugins → Add plugin**，输入固定版本：

```text
github:yintaocheng/dsh-github-harness#v0.3.0
```

检查后选择 **Install → Enable now**，按宿主提示重启。安装与启用是两步；不要修改正在运行的 desktop profile。

也可使用桌面自带的官方 CLI。先完全退出桌面，替换实际安装路径：

```powershell
$dsh = 'C:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add 'github:yintaocheng/dsh-github-harness#v0.3.0' --ignore-scripts
```

**npm 发布暂缓。** 当前不要用 `dsh-github-harness@0.3.0` 从 npm 或镜像安装；包元数据已准备，不代表 registry 上已发布。当前可用来源是上述 GitHub 固定标签。详见[分发说明](docs/distribution.md)与[桌面安装及权限](docs/desktop.md)。

## 配置自己的目标仓库

需要 Node.js 22+、Git、可用的 DSH headless 模型，以及有目标仓库写权限的 GitHub 身份。

1. 打开自己的项目或有权限的 Fork，本地 HTTPS `origin` 必须与配置一致。
2. 在**目标仓库根目录**创建配置，填写仓库、实际 GitHub 操作身份、DSH 命令和该项目的验收命令，参见[配置示例](docs/setup.md#配置示例)。
3. 忽略本地配置、`.harness/` 与 `.reference/`。**不要把 token 放进配置或 Issue。**
4. 准备 [GitHub 凭据](docs/setup.md#github-认证)，单独检查 [headless 模型](docs/setup.md#检查-dsh-模型)。

会话工作区包含 `my-project` 子目录时，先调用：

```json
{"action":"doctor","workdir":"my-project"}
```

确认身份和仓库后处理该仓库的 Issue：

```json
{"action":"run","issue":1,"workdir":"my-project"}
```

用 `action: "status"` 查询同一任务。以上是 `github_harness` 工具参数；也可直接用自然语言要求 DSH 调用。

`doctor` 检查登录身份、仓库、Issues / PR / Commit statuses / Checks 的实际读取能力及 DSH 命令。**读取成功不证明所有 token scope 或写权限已获验证。**

## 任务如何继续？

添加 Issue / PR 反馈后，对同一目标仓库、同一 Issue 再次 `run`：

- 复用原任务、分支、PR 和 DSH 任务会话；更换执行者名称不创建另一业务任务。
- 反馈、代码树和验收配置不变时返回 `unchanged`。
- 首轮没有可审查修改时返回 `waiting`，不创建空 PR。
- 只修改验收命令时重新验证，不额外调用模型。
- 旧版本任务保留原工件别名；存在多份冲突历史时拒绝猜测，要求人工核对。

模型会话与可信发布执行器分工：agent 修改代码，harness 独立验收后提交和发布，不让模型自行绕过验收推送。

## 示例、开发与边界

- **[独立演示仓库](https://github.com/yintaocheng/dsh-github-harness-demo)**：真实目标项目、具体任务、修改文件、提交与验收证据；不是插件安装源。
- [配置与源码 CLI](docs/setup.md)
- [命令、恢复与实现边界](docs/operations.md)
- [项目、任务、运行与未来参与者](docs/project-model.md)
- [分发与发布状态](docs/distribution.md)
- [DSH 接口依据](docs/interfaces.md)

插件开发回归：`node --test test/*.test.mjs`。具体演示过程与结果放在演示仓库，不与插件测试混算。

同一仓库未来可以有多个 agent 参与，但本版不调度多个 agent、不授予 GitHub 权限、不投票、不自动 approve 或 merge。未来 maintainer 简单多数策略的约束见[项目模型](docs/project-model.md#多-agent-与-maintainer兼容方向不是本版功能)。

只在可信仓库中运行。测试、Git hooks 与 agent 都会执行本地代码，这不是恶意代码隔离服务。

## 许可证

[MIT](LICENSE)，Copyright (c) 2026 yintaocheng。GitHub topic：[`dsh-plugin`](https://github.com/topics/dsh-plugin)。

本仓库维护通用插件；演示项目的配置与任务在[独立仓库](https://github.com/yintaocheng/dsh-github-harness-demo)。
