# 安装与配置

[← 返回 README](../README.md)

## 先准备什么

- Node.js 22+ 和 Git。
- DSH `0.2.0-rc.2`：这是当前插件声明支持、已核实接口的版本；不要用版本豁免代替兼容性验证。
- 一个你有权写入的目标 GitHub 仓库，已有基线提交、测试命令和 Issue。运行目录必须是目标仓库根目录，工作区应保持干净。
- 与配置一致的 GitHub 操作身份和可用的独立 headless 模型。

插件是可复用工具，**不要求 Fork 插件仓库**。你可以在自己的业务项目、另一个有权限的仓库或 [Demo 的个人 Fork](https://github.com/yintaocheng/dsh-github-harness-demo) 中使用。一次运行只处理一个目标仓库的一个 Issue；多个项目分别配置和运行。

## 选择安装入口

当前通过 GitHub 固定版本分发；npm 登录和发布暂缓，不使用未上架的包名安装。

### 桌面 Host 工具

官方 **Plugins → Add plugin** 输入 `github:yintaocheng/dsh-github-harness#v0.3.0`，安装并启用。见[完整桌面步骤](desktop.md)。宿主提供 DSH SDK peers。

### 独立源码 CLI

将固定版本插件源码放在独立工具目录，不复制进目标项目。无需 npm 安装；在**目标仓库根目录**执行：

```powershell
node 'C:\tools\dsh-github-harness\src\cli.mjs' --config harness.local.json doctor
node 'C:\tools\dsh-github-harness\src\cli.mjs' --config harness.local.json run 1
```

替换实际插件路径。CLI 仅使用 Node 内置模块，不加载 Host SDK；仍须自行提供 GitHub 凭据和可用的 headless 命令。见[双入口依赖说明](distribution.md#cli-与-host-的依赖边界)。不要切到插件仓库代替目标仓库运行任务。

## 配置示例

在**目标仓库**新建 `harness.local.json`，以以下内容或插件包内的[通用模板](../harness.config.json)为起点。替换所有占位符，尤其是仓库、账户、DSH 路径和项目验收命令：

```json
{
  "owner": "YOUR_ACCOUNT_OR_ORG",
  "repo": "YOUR_TARGET_REPO",
  "base": "main",
  "agent": {
    "id": "solo",
    "expectedLogin": "YOUR_GITHUB_LOGIN"
  },
  "dsh": {
    "command": ["C:\\path\\to\\dsh.cmd", "headless"]
  },
  "verify": [["node", "--test"]]
}
```

`node --test` 只是 Node 项目的示例；请改成能验证**目标项目**的真实测试 / 构建命令，不要照搬插件自己的回归测试命令。每项都是 argv 数组，不是 shell 字符串。

| 配置 | 含义 |
| --- | --- |
| `owner`、`repo` | 目标仓库所有者和名称，必须匹配 HTTPS `origin` |
| `base` | PR 的目标分支 |
| `agent.id` | 本次执行者名称，不是任务身份；旧工件别名保留，更换名称不重建任务 |
| `agent.expectedLogin` | `/user` 必须返回的实际登录账户，不一定等于仓库所有者 |
| `dsh.command` | 启动命令 argv；Windows 首项使用 `dsh.cmd` 的完整路径，路径有空格也不额外套引号 |
| `dsh.patch` | 可选的 DSH overlay 路径，例如 `.harness/model.patch.yml` |
| `verify` | 可信操作者指定的验收命令，不从 Issue 中拼接 shell |

非 Windows 可用 `"command": ["dsh", "headless"]`，前提是 `dsh` 在 PATH 中且可执行。桌面 Host 工具默认读取目标目录的 `harness.local.json`，不存在才读取 `harness.config.json`；**独立 CLI 请显式传入 `--config harness.local.json`**。

确保目标项目忽略以下本地文件与目录，并在开始任务前提交需要共享的忽略规则，使工作区干净：

```gitignore
harness.local.json
.harness/
.reference/
```

不要把 token、包含密钥的 overlay、诊断输出或任务缓存提交到仓库。插件安装目录不承担目标项目的任务状态。

## GitHub 认证

### Windows：使用 Git Credential Manager

```powershell
git credential-manager github login --browser
```

在浏览器登录与 `agent.expectedLogin` 一致的账户。桌面 `github_harness` 工具先使用进程环境凭据，否则读取 GCM。GCM 登录**不代表**独立 npm CLI 自动读取凭据；独立 CLI 需要下方环境变量，或显式使用随插件提供的[凭据桥](../scripts/run.ps1)：

```powershell
# 当前目录仍是目标仓库；下面是另一个位置的插件源码 / 已安装包路径
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\tools\dsh-github-harness\scripts\run.ps1' --config harness.local.json doctor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\tools\dsh-github-harness\scripts\run.ps1' --config harness.local.json run 1
```

凭据桥仅在子进程环境中传递 token，不写入配置、参数或日志。执行策略选项只作用于该子进程，不修改系统策略。随源码提供的 [Windows 启动器](../harness.cmd) 使用调用时的**目标工作目录**查找配置，可以通过插件目录中的绝对路径调用；不会误用插件安装目录的配置。

### 其他环境 / 已安装的 CLI：由环境提供凭据

通过自己的凭据管理机制向当前进程提供 `GH_TOKEN` 或 `GITHUB_TOKEN`，然后在目标仓库根目录执行：

```sh
dsh-github-harness --config harness.local.json doctor
dsh-github-harness --config harness.local.json run 1
dsh-github-harness --config harness.local.json status 1
```

不要把 token 写入脚本、Git URL、提示词或命令历史。GitHub API 与 Git HTTPS 使用同一个经核验的 token。CLI 的 `help`、`status`、`unlock` 是本地操作，不需要 GitHub 授权。

使用 fine-grained personal access token 时，在目标仓库的 **Repository permissions** 中配置：

| 权限 | 最低访问级别 | 用途 |
| --- | --- | --- |
| Contents | Read and write | 读取基线分支/代码、推送任务提交 |
| Issues | Read and write | 读取任务与评论、创建任务/维护检查点 |
| Pull requests | Read and write | 读取 PR 与审查、创建或更新 PR |
| Commit statuses | **Read-only** | 读取 `GET /repos/{owner}/{repo}/commits/{ref}/statuses` 的提交状态反馈 |
| Checks | Read-only | 读取基线提交或 PR head 的 check runs |
| Metadata | Read-only（GitHub 自动提供） | 核验仓库身份 |

**Commit statuses 与 Checks 是不同权限，不能互相替代。** [GitHub 官方：List commit statuses for a reference](https://docs.github.com/en/rest/commits/statuses#list-commit-statuses-for-a-reference) 要求 fine-grained token 的 **Commit statuses: read**，但公开资源也允许无认证读取。因此公开仓库 GET 成功只证明当前可读，**不证明 token 已获得该 scope**；私有仓库必须具备相应授权。

`doctor` 先核验实际登录账户与完整 `owner/repo`，随后只做 GET：验证 Issues、Pull requests 读取，解析 `base` 分支 SHA，再调用该 SHA 的 statuses 与 check-runs。仓库尚未 bootstrap、对当前凭据不可见、没有基线提交或配置分支时，相关能力显示**尚未验证**。HTTP 403 视为读取失败/能力不足（也可能受组织策略或限流影响），不当成空仓库。

只读探测不能无损证明 token 的写权限，仓库 `push` 权限也不等同于 token-specific 写 scope。创建 Issue/PR、评论和推送仍需实际授权。创建仓库、读取 Actions 运行/日志、推送 workflow 文件可能需要额外权限，并受组织策略限制。

## 检查 DSH 模型

`doctor` 只检查 DSH 命令能否启动，不验证模型凭据。首次使用时单独做一次最小调用：

```powershell
& 'C:\path\to\dsh.cmd' headless --json 'Reply only OK. Do not use tools.'
```

应正常退出，最后有 `type: final` 事件。**桌面聊天能用，不代表默认 headless 模型已配置。**

如果 headless 报模型或凭据错误，按自己的 DSH 配置建立 overlay，并在 `dsh.patch` 中引用：

```json
"dsh": {
  "command": ["C:\\path\\to\\dsh.cmd", "headless"],
  "patch": ".harness/model.patch.yml"
}
```

模型选择和 provider 路由都需有效；只改 model 名称不等于配置 provider。overlay 只放凭据引用，例如 `apiKeyEnv`，不要复制密钥值。参见 [DSH 配置接口](interfaces.md)。

## 网络与恢复

若系统已使用代理但 Git 直连超时，在当前终端显式设置 `HTTPS_PROXY` 为自己的代理地址。不要照搬别人的端口、关闭 TLS 校验或修改全局 registry。npm 源问题与 GitHub / 模型连接问题需分别诊断。

`publishing` 阶段失败后重跑同一个目标仓库、同一个 Issue 的命令：它会复用已验证的提交，不重新执行模型。详细行为见[运行与恢复](operations.md)。

## 需要新建仓库？

在目标项目已初始化 Git、配置正确后运行 `bootstrap`。它只为当前账户创建**私有个人仓库**；已存在则核验后复用，不自动改为 public，也不自动提交基线。`bootstrap` 不是安装步骤，使用现有仓库时无需运行。
