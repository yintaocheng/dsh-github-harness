# dsh-github-harness

**给一个 GitHub Issue，让 DSH 修改代码、运行测试，并提交一个供你审查的 PR。**

```text
Issue → DSH agent → 修改与测试 → PR + 结果回写
  ↑                              │
  └──────── 新反馈，继续同一任务 ──┘
```

这是一个单 agent 的最小原型。手动启动，复用已有分支和 PR，**不自动合并**。

## 开始使用

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

`doctor` 检查登录身份、目标仓库和 DSH 命令。首次使用还需确认模型能正常回答，见 [模型检查](docs/setup.md#检查-dsh-模型)。无需安装 npm 依赖。

### 3. 运行一个 Issue

先在目标仓库创建 Issue，写清任务和验收条件。然后运行，例如 Issue #1：

```powershell
.\harness.cmd run 1
.\harness.cmd status 1
```

成功后会返回 **PR 地址、提交 SHA 和 DSH session ID**，并在 Issue 留下验证结果。

在 Issue 或 PR 添加反馈后，**再次运行同一个 `run 1`**。它会继续原任务；没有新反馈时返回 `unchanged`。

## 在 DSH 中怎么用？

在 DSH 会话里，让 agent 以本项目目录为工作目录执行以上命令即可。当前入口是 **CLI + 薄 Cordis 插件**，还没有 DSH 界面按钮。执行任务时会启动独立的 headless 会话；不是让当前对话直接代写成果。

只在你信任的代码仓库中运行。测试和 agent 都会执行本地代码；这不是恶意代码隔离服务。

## 已经跑通了什么？

[Issue #1](https://github.com/yintaocheng/dsh-github-harness/issues/1) → [PR #2](https://github.com/yintaocheng/dsh-github-harness/pull/2) 已真实完成首次修改、反馈续跑和结果回写，并验证了重复启动与发布中断恢复。详细证据见 [验证记录](docs/validation.md)。

- [安装、认证与模型配置](docs/setup.md)
- [命令、恢复与实现边界](docs/operations.md)
- [DSH 接口依据](docs/interfaces.md)

目前不做多 agent 协调、自动触发、投票或自动合并。先把单 agent 闭环做可靠，再逐步扩展。
