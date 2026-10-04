# dsh-github-harness

**让 GitHub Issue 成为 DSH 的任务入口，让 PR 成为代码交付入口。**

在 Issue 中写下需求，DSH 负责修改代码；harness 运行你指定的验收命令，成功后提交 PR。把修改意见留在 Issue 或 PR，再次运行即可继续原任务，无需重新整理上下文。

```text
Issue → DSH 实现 → 独立验收 → Pull Request
  ↑                              │
  └────── 修改意见 / CI 反馈 ──────┘
```

## 功能

- **按任务管理上下文**：每个 Issue 使用自己的分支、DSH 会话和 PR。
- **持续处理反馈**：读取 Issue 评论、PR 审查和 CI 结果，续跑同一任务。
- **先验证，再发布**：验收失败不推送；没有代码变更时不创建空 PR。
- **支持多个项目**：插件只需安装一次，调用时选择目标仓库；同一 checkout 中的任务串行执行。
- **保留人工审查**：稳定版不自动批准或合并 PR。

## 安装

需要 **DeepSeek Harness 0.2.0-rc.2、Node.js 22+ 和 Git**。

在 DSH 的 **Plugins → Add plugin** 中输入：

```text
github:yintaocheng/dsh-github-harness#v0.3.0
```

安装后启用插件，按宿主提示完成重启。工具名称为 `github_harness`。[CLI 安装与详细步骤 →](docs/desktop.md)

## 快速开始

### 1. 准备目标项目

打开一个已有基线提交的 Git 仓库，确保 HTTPS `origin` 指向你有写权限的 GitHub 仓库。插件源码不需要放进这个项目。

Windows 可通过 Git Credential Manager 登录：

```powershell
git credential-manager github login --browser
```

其他凭据方式见[认证配置](docs/setup.md#github-认证)。同时确认 DSH 的 [headless 模型](docs/setup.md#检查-dsh-模型)可用。

### 2. 配置验收

在目标仓库根目录新建 `harness.local.json`：

```json
{
  "owner": "YOUR_ACCOUNT_OR_ORG",
  "repo": "YOUR_PROJECT",
  "base": "main",
  "agent": { "id": "solo", "expectedLogin": "YOUR_GITHUB_LOGIN" },
  "dsh": { "command": ["dsh", "headless"] },
  "verify": [["node", "--test"]]
}
```

替换仓库、登录账户和验收命令。Windows 若无法从 PATH 找到 `dsh`，将命令首项替换为桌面自带 `dsh.cmd` 的绝对路径。[完整配置说明 →](docs/setup.md#配置示例)

将以下条目加入目标项目的忽略规则，不要提交凭据或本地运行状态：

```gitignore
harness.local.json
.harness/
.reference/
```

### 3. 运行一个 Issue

先在 GitHub 创建 Issue，写清需求、范围和验收条件。然后在 DSH 中说：

> 用 github_harness 检查 my-project 的配置，然后处理该仓库的 Issue #42。

也可以直接调用工具：

```json
{"action":"doctor","workdir":"my-project"}
{"action":"run","issue":42,"workdir":"my-project"}
{"action":"status","issue":42,"workdir":"my-project"}
```

`workdir` 可以是绝对路径，也可以相对当前 DSH 会话工作区。PR 创建后，在 Issue 或 PR 留下反馈，再次对同一目录和 Issue 执行 `run`。

## 使用须知

- `doctor` 检查身份、仓库读取能力和 DSH 命令；它不会替你创建仓库或验证所有写权限。
- GitHub 配置必须匹配目标 checkout；不要通过复制任务缓存切换仓库或账户。
- 工具需要宿主授权的文件、进程和网络访问。仅用于可信仓库：agent、测试和 Git hooks 都可能执行本地代码。

## 文档与示例

- [安装、模型与凭据配置](docs/setup.md)
- [命令、反馈续跑与中断恢复](docs/operations.md)
- [独立演示项目](https://github.com/yintaocheng/dsh-github-harness-demo)
- [开发接口](docs/interfaces.md) · [项目与任务模型](docs/project-model.md)

## License

[MIT](LICENSE)

本项目是 DeepSeek Harness 社区插件。
