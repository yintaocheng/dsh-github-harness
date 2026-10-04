# 命令与恢复

[← 返回 README](../README.md)

## 常用命令

从**目标仓库**根目录调用已安装的 `dsh-github-harness --config harness.local.json ACTION`，或使用桌面[工具入口](desktop.md)。目标仓库不需要包含插件源码。下表以开发 checkout 的 Windows [启动器](../harness.cmd)为简写；使用源码时应通过插件文件的绝对路径调用并保留目标 cwd，不能在目标仓库假设存在 `src/cli.mjs`。认证方式见[配置说明](setup.md)。

| 命令 | 用途 |
| --- | --- |
| `harness.cmd help` | 查看命令入口 |
| `harness.cmd doctor` | 身份、仓库、实际读取能力及 DSH 命令检查 |
| `harness.cmd run 1` | 首次处理 Issue #1，或继续同一任务 |
| `harness.cmd status 1` | 只读本地阶段、session 与进程锁，不查凭据 |
| `harness.cmd unlock` | 仅在记录的 runner / child 均退出后清理残留锁 |
| `harness.cmd bootstrap` | 按配置创建或复用私有个人仓库 |

CLI 还提供 `issue-create TITLE BODY_FILE` 与 `comment NUMBER BODY_FILE`。`comment` 接受 Issue 或 PR 编号；一般直接在 GitHub 写任务与反馈更方便。

## 一次执行会做什么

1. 核对 GitHub `/user`、配置仓库、仓库权限及本地 HTTPS origin。
2. 读取 Issue、评论、原 PR 的评论 / review / 行内评论及当前 head 的 CI 摘要。
3. 新任务使用与执行者名称无关的分支 `harness/issue-<number>`；唯一匹配的旧任务继续保留原 `harness/<agent.id>/issue-<number>` 等工件别名，按需恢复原 DSH 任务会话。业务身份与旧 key 的区别见[项目模型](project-model.md)。
4. 暂存并固定候选树，检查实际交付文件，独立执行 `verify`；随后再次固定树，拒绝验收过程中改变树或 HEAD 的情况。
5. 提交后核对最终 tree 和单一预期 parent。hook 改变树时撤销旧证明，并对实际提交内容重验；失败不推送。
6. 在 push 前再次核对 tree、验收命令摘要、HEAD 与工作区，按**明确 SHA** 非强制推送，再更新原 PR 和 Issue 检查点。

报告将实际执行的退出码、验证树、命令配置摘要与 agent 自述分开。成功发布不等于 PR 已获批准，仍需 CI 与人工审查。

## 去重与验证绑定

GitHub 输入摘要只决定是否有新反馈；它不再充当验证证明。验证记录单独绑定：

```text
validation = { tree: Git tree OID, verifyHash: SHA256(JSON.stringify(config.verify)) }
```

- 反馈、代码树、验收命令及本地/PR HEAD 都不变，才可返回 `unchanged`。
- 只改变验收命令，或恢复路径发现候选树不同，会先重验，不为配置变化额外调用模型。
- `done`、`validated`、`publishing` 均不能复用不匹配的证明。旧元数据缺少绑定时也须重验。
- 新模型轮次总是独立验收，即使它最终没有修改文件。
- 首轮没有相对基线的可审查变化时进入 `waiting`：保存说明、会话与输入摘要，更新 Issue，但不创建空 PR。原样重复不会重复调用模型；新反馈继续原会话。
- 已存在 PR 时，“本轮没有新修改”不等于“任务没有可审查提交”；保留原 PR。

只忽略该任务、该操作身份写出的机器检查点；同账号手工反馈仍会处理。已关闭或合并的 PR 不会被重建。

## 中断后怎么做

先执行 `status ISSUE`：

| 阶段 | 处理方式 |
| --- | --- |
| `working` | 保留修改，重跑，在原会话继续 |
| `waiting` | 没有可审查修改，等待澄清；新反馈可启动下一轮 |
| `validated` | 保留原提交意图，先检查是否已提交；再检查树/命令绑定 |
| `publishing` | 复用提交；如验收配置或内容变化先重验，再补 push / PR / 回写 |
| `done` | 已发布；新反馈继续处理，只改验收配置则只重验 |

- 不自动 reset、stash 或覆盖无关的脏工作区。unexpected parent、远端超前/分叉或违规分支变化需要人工检查。
- 恢复提交时先检查原 `oldHead`，不能先重暂存覆盖该提交意图；正常提交和恢复提交都核对 parent。
- 残留锁不自动抢占。确认相关进程退出后再 `unlock`；活进程会被拒绝。
- 本地任务缓存丢失时，从 PR 元数据恢复；无 PR 的 `waiting` 可从 Issue 检查点恢复。模型历史仍须保存在本机，找不到时明确失败。
- 本地缓存和日志在忽略的 `.harness/` 中；GitHub 保存公开任务事实，DSH 保存会话，没有额外任务数据库。
- 发布恢复期间新到的反馈不会被提前标为已处理，下次运行仍会消费它。

## 发布扫描范围

扫描的是固定候选 Git tree 相对任务与基线 merge-base 的新增/修改 blob，包括之前任务提交仍留在候选树中的文件，以及新暂存文件；不是遍历整个仓库的工作区文件。未修改的历史大文件不会挡住一个小任务。

对实际交付文件检查常见 token / 私钥、敏感文件名、symlink / 非 blob 类型与 2 MiB 上限。删除无需读取旧内容。被跟踪的 `.harness/`、`.reference/` 仍会全局拒绝。此防护不是完整的秘密检测或恶意 Git 配置隔离系统。

## 实现位置

| 文件 | 职责 |
| --- | --- |
| [CLI](../src/cli.mjs) / [共享执行器](../src/runner.mjs) | 手动入口与显式工作目录执行 |
| [桌面插件](../src/desktop-plugin.mjs) / [工具](../src/desktop-tool.mjs) | 官方注册、权限门、生命周期与取消 |
| [任务闭环](../src/core.mjs) | 等待、去重、验证绑定、恢复和发布 |
| [GitHub 适配器](../src/github.mjs) | 身份、只读诊断、分页、PR / 评论更新 |
| [Git 适配器](../src/repo.mjs) | 分支、候选 blob、验证、提交与推送 |
| [DSH 执行器](../src/dsh.mjs) / [receipt 插件](../src/plugin.mjs) | 独立 headless 与会话关联 |
| [进程执行器](../src/process.mjs) | 文件描述符日志和取消进程树 |

## 边界

- 只支持 HTTPS origin，以保证 Git 与 API 使用同一经核验身份。
- 一个工作目录只运行一个执行者；锁不是跨机器的分布式锁。
- GitHub 文本作为不可信数据传入，不直接拼接成 shell；但同一 OS 用户下的测试、Git hooks 和进程不是恶意代码隔离边界。
- 不自动处理冲突、跨 fork PR 或缺失的 DSH 历史；未覆盖任意断电时刻的完整恢复矩阵。
- CI 读取摘要，不下载 job logs；反馈超过 2000 条会失败，不静默截断。
- 不含 webhook、定时调度、多 agent 协调、投票、自动审批或合并。
