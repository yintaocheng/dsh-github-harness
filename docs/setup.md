# 安装与配置

[← 返回 README](../README.md)

## 先准备什么

- Node.js 22+ 和 Git。
- DSH `0.2.0-rc.2`：本项目已核实这一版本的 headless 接口；其他版本请先检查命令帮助。
- 目标仓库已有基线提交、测试命令和 Issue。运行目录必须是目标仓库根目录，工作区应保持干净。
- 可以写入该仓库的 GitHub 账户。公开可读不等于任何人都有写权限；通常先 Fork 再试用。

零第三方 Node 依赖，不需要 `npm install`。本项目目前最容易在自己的 Fork 中验证；没有承诺能通过一个配置直接调度任意多个本地仓库。

## 配置示例

从 [默认配置](../harness.config.json) 复制一份为被 Git 忽略的 `harness.local.json`。Windows 启动器优先读取该本地配置，不存在时才使用默认配置。

```json
{
  "owner": "YOUR_ACCOUNT",
  "repo": "dsh-github-harness",
  "base": "main",
  "agent": {
    "id": "solo",
    "expectedLogin": "YOUR_ACCOUNT"
  },
  "dsh": {
    "command": ["C:\\path\\to\\dsh.cmd", "headless"]
  },
  "verify": [["node", "--test", "test/*.test.mjs"]]
}
```

请替换账户名和 DSH 路径，不要原样使用占位符。

| 配置 | 含义 |
| --- | --- |
| `owner`、`repo` | 仓库所有者和名称，必须匹配 HTTPS `origin` |
| `base` | PR 的目标分支 |
| `agent.id` | 稳定的执行者名称，用于关联任务和分支 |
| `agent.expectedLogin` | `/user` 必须返回的实际登录账户，不一定等于仓库所有者 |
| `dsh.command` | 启动命令的 argv 数组；路径有空格也无需额外套引号 |
| `dsh.patch` | 可选的 DSH overlay 路径，例如 `.harness/model.patch.yml` |
| `verify` | 由可信操作者指定的验证命令数组，不从 Issue 中拼接 shell |

不是 Windows 时，可使用 `"command": ["dsh", "headless"]`，前提是 `dsh` 已在 PATH 中且可以执行。

## GitHub 认证

### Windows：使用 Git Credential Manager

```powershell
git credential-manager github login --browser
.\harness.cmd doctor
```

在浏览器登录与 `agent.expectedLogin` 一致的账户。凭据保留在凭据管理器中，不填写到配置或 Issue。

[Windows 启动器](../harness.cmd) 调用 [凭据桥](../scripts/run.ps1)，只在进程内传递 token。PowerShell 的执行策略选项仅作用于该子进程，不修改系统策略。`help`、`status`、`unlock` 是本地操作，不需要 GitHub 授权。

### 其他环境：由环境提供凭据

通过自己的凭据管理机制设置 `GH_TOKEN` 或 `GITHUB_TOKEN`，然后：

```sh
node src/cli.mjs --config harness.local.json doctor
node src/cli.mjs --config harness.local.json run 1
```

不要把 token 写入脚本、Git URL、提示词或命令历史。GitHub API 与 Git HTTPS 使用同一个经核验的 token。

使用 fine-grained personal access token 时，请在目标仓库的 **Repository permissions** 中配置：

| 权限 | 最低访问级别 | 用途 |
| --- | --- | --- |
| Contents | Read and write | 读取基线分支/代码、推送任务提交 |
| Issues | Read and write | 读取任务与评论、创建任务/维护检查点 |
| Pull requests | Read and write | 读取 PR 与审查、创建或更新 PR |
| Commit statuses | **Read-only** | 读取 `GET /repos/{owner}/{repo}/commits/{ref}/statuses` 的提交状态反馈 |
| Checks | Read-only | 读取基线提交或 PR head 的 check runs |
| Metadata | Read-only（GitHub 自动提供） | 核验仓库身份 |

**Commit statuses 与 Checks 是不同权限，不能互相替代。** [GitHub 官方：List commit statuses for a reference](https://docs.github.com/en/rest/commits/statuses#list-commit-statuses-for-a-reference) 明确要求 fine-grained token 的 **Commit statuses: read**。该文档也说明：仅访问 **public 资源**时，这个接口允许无需认证、或无需上述权限读取。因此，在公开仓库上 GET 成功只证明资源当前可读，**不证明当前 token 已获该 scope**；私有仓库必须具备相应授权。

`doctor` 的 GitHub 诊断先核验实际登录账户与完整 `owner/repo`，随后只做 GET：验证 Issues、Pull requests 读取，并解析配置的 `base` 分支 SHA，真实调用该 SHA 的 statuses 与 check-runs 接口。仓库尚未 bootstrap（或对当前凭据不可见）、没有基线提交或缺少配置的分支时，会明确显示相关能力**尚未验证**，而不是报告全部可用。HTTP 403 属于读取失败/能力不足（也可能受组织策略或限流影响），不会被当成空仓库。

只读探测不能无损证明 token 的写权限；仓库 `push` 权限也不等同于 token-specific 写 scope。即使所有读探测通过，创建 Issue/PR、评论和推送等操作的授权仍未验证。创建仓库需要额外权限；若还需读取 Actions 运行或日志，应另外授予 Actions: read；推送 workflow 文件还需 GitHub 要求的 workflow 权限。实际权限仍取决于 OAuth、经典 token、细粒度 token 以及组织授权策略。

## 检查 DSH 模型

`doctor` 只检查 DSH 命令能否启动，不会验证模型凭据。首次使用时单独做一次最小调用：

```powershell
& 'C:\path\to\dsh.cmd' headless --json 'Reply only OK. Do not use tools.'
```

应正常退出，最后有 `type: final` 事件。**桌面聊天能用，不代表默认 headless 模型也已配置。**

如果 headless 报模型或凭据错误，请按自己的 DSH 配置建立 overlay，并在 `dsh.patch` 中引用它：

```json
"dsh": {
  "command": ["C:\\path\\to\\dsh.cmd", "headless"],
  "patch": ".harness/model.patch.yml"
}
```

模型选择和 provider 路由都需有效；仅改一个 model 名字不等于配置了 provider。overlay 只放凭据引用，例如 `apiKeyEnv`，不要复制密钥值。参见 [已核实的 DSH 配置接口](interfaces.md)。

## 网络问题

若系统已使用代理，但 Git 直连 GitHub 超时，请在当前终端显式设置 `HTTPS_PROXY` 为自己的代理地址，再重试。不要照搬他人的本机端口，不要关闭 TLS 证书校验。

`publishing` 阶段失败后重跑原命令即可：它复用已经验证的提交，不重新执行模型。详细行为见 [运行与恢复](operations.md)。

## 需要新建仓库？

在项目目录已经初始化 Git、配置正确后运行 `bootstrap`。它只为当前账户创建**私有个人仓库**；已经存在则核验后复用。它不会自动把仓库改成 public，也不自动提交基线。
