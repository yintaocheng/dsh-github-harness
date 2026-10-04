# dsh-github-harness

一个刻意保持很小的 DSH / GitHub 单 agent 执行闭环：指定 Issue → 独立 DSH headless 会话修改代码 → 本地确定性验证 → 提交 / PR → Issue 检查点。再次运行同一命令读取 Issue、PR 评论、review、行内评论和当前 head 的 CI 反馈，续跑同一会话 / 分支 / PR。**不自动合并，不创建 agent 团队，不运行后台调度器。**

## 运行要求与信任边界

- Node.js 22+、Git、DSH `0.2.0-rc.2`（本机已核验 `headless --json` / `--session-id`）。零 npm 依赖，无需 `npm install`。
- DSH headless 需要可用模型路由 / 凭据。桌面可用不等于默认 headless 路由可用；可通过 `dsh.patch` 使用自己的 Cordis overlay。项目从不复制或打印模型密钥。
- GitHub 凭据通过 `GH_TOKEN` / `GITHUB_TOKEN` 或 Windows Credential Manager 提供。创建私有个人仓库需相应权限；现有仓库需 Contents、Issues、Pull requests 读写，以及 Checks / Actions 读取权限。推送 CI 文件还需要 GitHub 所要求的 workflow 权限。Git push 本身使用 Git 凭据管理器或你配置的 Git 认证。
- 每次写入前核验 `/user`、仓库完整名及 push 权限。`owner` 是仓库所有者，`agent.expectedLogin` 是实际操作身份；**二者可以不同**，但 `bootstrap` 只支持为当前身份创建个人仓库。
- 只在可信代码仓库运行。验证命令来自操作者配置，不从 Issue 执行 shell。GitHub 文本标记为不可信数据。桥接器移除传给 DSH 子进程的 GitHub token 环境变量，但这不是隔离恶意代码的完整安全边界：同一 OS 用户仍可能访问凭据管理器，测试本身也是可执行代码。

## 最小结构

- [CLI](src/cli.mjs)：doctor、bootstrap、run、status、unlock，以及演示所用的 Issue/comment 命令。
- [任务闭环](src/core.mjs)：薄编排、反馈哈希、检查点，不建重复任务数据库。
- [GitHub](src/github.mjs)：REST、分页、身份校验、PR / 评论 upsert。
- [Git](src/repo.mjs)：保守分支复用、验证、提交及非强制推送。
- [DSH](src/dsh.mjs) / [Cordis 插件](src/plugin.mjs)：调用真实 CLI；插件通过 `session/event` 记录任务与会话关联。
- [配置](harness.config.json)、[Windows 凭据桥](scripts/run.ps1)、[测试](test/core.test.mjs)、[CI](.github/workflows/ci.yml)。

`.harness/` 仅放本地锁、会话关联、反馈哈希、发布进度和日志，全部被 Git 忽略；DSH 自己持久化会话。`.reference/` 是本次接口研究缓存，不入库。没有第二个 Git 仓库 / worktree。

## 启动

**工作目录必须是目标 Git 仓库根目录**。本次目录为 `C:\Users\yin taocheng\Documents\deepseek-harness\default-workspace\dsh-github-harness`，不是默认工作区根。

编辑 [配置](harness.config.json)，或复制成被忽略的 `harness.local.json`：

```json
{
  "owner": "yintaocheng",
  "repo": "dsh-github-harness",
  "base": "main",
  "agent": { "id": "solo", "expectedLogin": "yintaocheng" },
  "dsh": { "command": ["dsh", "headless"] },
  "verify": [["node", "--test", "test/*.test.mjs"]]
}
```

`dsh.command` 是 argv 数组。Windows 使用安装中的 `dsh.cmd` 完整路径；需要模型覆盖时增加 `dsh.patch` 字段。配置只能包含凭据**引用**，不填密钥。更换仓库时同时改配置与 Git origin；身份 / 远端不匹配会拒绝执行。

Windows（首次登录在浏览器完成，不将 token 放入命令行）：

```powershell
git credential-manager github login --username yintaocheng --browser
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/run.ps1 --config harness.local.json doctor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/run.ps1 --config harness.local.json bootstrap
```

`-ExecutionPolicy Bypass` 只作用于当前 PowerShell 进程，不修改系统执行策略。`doctor` 是只读校验。`bootstrap` 创建**私有**仓库并设置 origin，存在则核验后复用，不删除 / 重建远端。基线代码由操作者检查后提交并推送到 `main`（本交付已完成时无需再做）。

```powershell
node --test test/*.test.mjs
# 检查待提交文件，确认没有凭据，然后提交基线并推送 main。
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/run.ps1 --config harness.local.json run 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/run.ps1 --config harness.local.json status 1
# 收到反馈后，用完全相同的命令继续；没有新反馈时不调用模型。
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/run.ps1 --config harness.local.json run 1
```

Linux/macOS 或已配置 token 环境的终端：

```sh
node src/cli.mjs doctor
node src/cli.mjs bootstrap
node src/cli.mjs run 1
node src/cli.mjs status 1
```

本地操作身份依赖当前环境，而不是 agent 名字。后续可新增不同 `agent.id` 和 `expectedLogin`，但首版工作目录锁只允许一个执行者；**不能据此声称已实现多 agent 并行**。

## 手动 Issue 引用解析

独立纯函数 `parseIssueRef(text)` 可解析 `owner/repo#123` 或规范的 `https://github.com/owner/repo/issues/123`，去除首尾空白并保留 owner/repo 拼写。非法输入会抛出异常；Issue 编号必须是正的安全整数。URL 仅接受上述精确格式，不接受 HTTP、其他主机、凭据、端口、查询字符串、片段、PR 路径或额外路径段（包括尾部 `/`）。不接受引用格式以外的命令 / shell 标点，且尚未接入 CLI，现有命令行为不变。

```js
import { parseIssueRef } from './src/issue-ref.mjs';

parseIssueRef('  Owner/my-repo#123  ');
// => { owner: 'Owner', repo: 'my-repo', issue: 123 }

parseIssueRef('https://github.com/DeepSeek-AI/deepseek-harness/issues/123');
// => { owner: 'DeepSeek-AI', repo: 'deepseek-harness', issue: 123 }
```

## 去重与恢复

- 稳定分支：`harness/<agent.id>/issue-<number>`。按 head 查询所有状态的 PR；已有 open PR 更新，closed / merged PR 停止，绝不偷偷重开。
- 输入哈希覆盖任务正文、Issue/PR 评论、review、行内评论和 CI。仅忽略该身份、该任务标记的检查点；同一账号手工发表的反馈仍会处理。
- 同一输入 + 相同本地/远端 SHA 时不再调用模型或提交；相同检查点正文也不重复写。
- 运行阶段为 `working → validated → publishing → done`。发布失败可复用已验证提交、查找已有 PR、补写检查点，而不重新调用模型。
- 本地状态丢失可从 PR 内嵌的最小元数据找回 session/输入哈希/commit；会话仍需存在于本机 DSH。找不到会话会显式失败，**不会悄悄新建失忆会话**。
- dirty tree 只在同任务的 `working/validated` 恢复阶段保留并继续；其他脏目录拒绝执行，不 reset / stash 用户改动。
- 中断后先 `status` 看 task、session receipt 和 PID。进程锁残留时先确认 runner 和 child 均退出，再运行 `unlock`；工具会检查两个 PID，活进程不会被自动夺锁。
- 最小发布扫描拒绝常见 token / 私钥、敏感文件名、大文件和 symlink；不是完整的 secret scanner。请审查 PR。

## 首个完整流程如何验证

1. 在配置仓库创建一个带验收条件的 Issue，确保 main 有可运行测试。
2. `run ISSUE`：记录 DSH session ID、任务分支、提交 SHA、PR URL；核实 PR 的 `Closes #ISSUE`、实际 diff、验证退出码及 Issue 检查点。
3. 等待 GitHub Actions 结果，核实 checks 对应准确的 PR head SHA。
4. 在 Issue 或 PR 加一条额外验收条件，再 `run ISSUE`；要求同 session / 同 PR、新 SHA、新测试。
5. 反馈稳定后再跑，要求 `unchanged`；离线故障注入覆盖“PR 已创建但响应丢失”和“检查点写入失败”。

见 [接口依据](docs/interfaces.md) 和交付时补充的验证记录。模型自然语言“测试通过”不是证明，桥接器独立执行 `verify` 并记录退出码；GitHub CI 单独显示，不冒充已经完成。

## 当前限制

手动启动；不处理 webhook、不自动轮询、投票、辩论、审批或合并。CI 读取 Checks / commit statuses 的元数据和摘要，不下载 job logs。反馈超过 2000 条显式失败，不静默截断。暂不处理跨 fork PR、远端分支超前 / 冲突、自动迁移不存在的旧 session、恶意仓库隔离或分布式锁。Git 和 GitHub 之间没有跨系统事务，通过稳定分支和查询后 upsert 保守恢复。
