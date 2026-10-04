# dsh-github-harness

**给一个 GitHub Issue，让 DSH 修改代码、运行测试，并提交一个供你审查的 PR。**

```text
Issue → DSH agent → 修改与测试 → PR + 结果回写
  ↑                              │
  └──────── 新反馈，继续同一任务 ──┘
```

这是一个单 agent 的最小原型。手动启动，复用已有分支和 PR，**不自动合并**。

## 桌面版安装

已适配 **DeepSeek Harness 桌面版 0.2.0-rc.2** 的官方插件管理器：

1. 打开侧栏 **Plugins → Add plugin**。
2. 粘贴下面的安装地址，检查后点击 **Install → Enable now**。

```text
github:yintaocheng/dsh-github-harness#v0.2.0
```

启用后，对话中可使用 `github_harness` 的 `doctor / status / run`。例如：

> 在当前工作区的 dsh-github-harness 仓库中，先调用 github_harness doctor；确认身份后处理 Issue #1。

**安装插件不等于已经配置 GitHub 和模型**：首次使用仍需完成下方配置与登录。Host 工具按官方权限机制申请本次访问；受限模式且不允许审批时会拒绝运行，不会绕过沙箱。没有伪造的 `dsh://install` 链接，也没有额外启动服务。

[桌面安装、权限与实测边界](docs/desktop.md)

## 配置与命令行使用

需要 **Node.js 22+、Git、可用的 DSH headless 模型**，以及有目标仓库写权限的 GitHub 账户。以下是已验证的 Windows 用法；[其他环境与详细配置](docs/setup.md)。

### 1. 准备仓库和配置

使用自己的 Fork 或有写权限的仓库，不要直接向别人的仓库运行。

```powershell
git clone https://github.com/YOUR_ACCOUNT/dsh-github-harness.git
cd dsh-github-harness
Copy-Item harness.config.json harness.local.json
```

将 `YOUR_ACCOUNT` 换成你的 GitHub 账户。已有本地项目可跳过以上步骤。

编辑刚复制的本地配置：

- `owner` / `repo`：目标仓库；必须与 Git `origin` 一致。
- `agent.expectedLogin`：实际操作的 GitHub 账户；`agent.id` 是执行者名称。
- `dsh.command`：DSH 启动命令；Windows 首项填写 **`dsh.cmd` 的完整路径**。

完整示例见 [配置说明](docs/setup.md#配置示例)。**不要把 token 写进配置。**

### 2. 登录并检查

```powershell
git credential-manager github login --browser
.\harness.cmd doctor
```

`doctor` 检查登录身份、目标仓库、Issues / PR / **Commit statuses** / Checks 的实际读取能力，以及 DSH 命令。读取成功不等于写权限或全部 token scope 已获验证。首次使用仍需确认模型能正常回答，见 [模型检查](docs/setup.md#检查-dsh-模型)。CLI 无需 `npm install`；桌面 peer 服务由宿主提供。

### 3. 运行一个 Issue

先在目标仓库创建 Issue，写清任务和验收条件。然后运行，例如 Issue #1：

```powershell
.\harness.cmd run 1
.\harness.cmd status 1
```

成功后会返回 **PR 地址、提交 SHA 和 DSH session ID**，并在 Issue 留下验证结果。

在 Issue 或 PR 添加反馈后，**再次运行同一个 `run 1`**。它会继续原任务；反馈、代码树与验收配置均不变时返回 `unchanged`。首轮没有可审查修改时返回 `waiting`，记录原因而不创建空 PR；补充反馈后可继续。只修改验收命令时会重验，不额外调用模型。

## 在 DSH 中怎么用？

桌面版安装后使用 `github_harness`；也可以继续让 DSH 在目标仓库运行上述 CLI。当前提供 **CLI + 桌面 Host 工具**，没有额外的任务管理页面。执行时仍会启动独立 headless 会话，不是让当前对话直接代写成果。

本次修复已通过 **81 项 Windows 测试**，包括真实 Git hook、大文件基线和子进程取消；安装包已在桌面携带 runtime 的隔离 profile 验证注册、权限拒绝和实际 `status` 调用。未擅自修改正在使用的桌面 profile。

只在你信任的代码仓库中运行。测试和 agent 都会执行本地代码；这不是恶意代码隔离服务。

## 已经跑通了什么？

- [Issue #1 → PR #2](https://github.com/yintaocheng/dsh-github-harness/pull/2)：修改、反馈续跑、去重及中断恢复。
- [Issue #3 → PR #4](https://github.com/yintaocheng/dsh-github-harness/pull/4)：在 DSH 中运行本页的短命令，生成文档回归测试；任务分支 19 项测试和 GitHub CI 通过。

两次都是实际模型执行，PR 保留供审查。详细证据见 [验证记录](docs/validation.md)。

- [安装、认证与模型配置](docs/setup.md)
- [命令、恢复与实现边界](docs/operations.md)
- [DSH 接口依据](docs/interfaces.md)

目前不做多 agent 协调、自动触发、投票或自动合并。先把单 agent 闭环做可靠，再逐步扩展。
