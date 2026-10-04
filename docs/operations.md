# 命令与恢复

[← 返回 README](../README.md)

## 常用命令

以下从目标仓库根目录执行。Windows 使用 [启动器](../harness.cmd)；其他环境使用 `node src/cli.mjs --config harness.local.json` 代替 `harness.cmd`。

| 命令 | 用途 |
| --- | --- |
| `harness.cmd help` | 查看命令入口 |
| `harness.cmd doctor` | 检查账户、仓库和 DSH 命令 |
| `harness.cmd run 1` | 首次处理 Issue #1，或继续同一任务 |
| `harness.cmd status 1` | 查看本地任务阶段、session 和进程锁 |
| `harness.cmd unlock` | 仅在记录的 runner / child 均退出后清理残留锁 |
| `harness.cmd bootstrap` | 按配置创建或复用私有个人仓库 |

CLI 还提供 `issue-create TITLE BODY_FILE` 和 `comment NUMBER BODY_FILE`，用于手动验证。`comment` 接受 Issue 或 PR 编号。仓库已有网页界面时，直接在 GitHub 写任务和评论通常更方便。

## 一次执行会做什么

1. 核对 GitHub `/user`、配置仓库、写权限及本地 HTTPS origin。
2. 读取 Issue、评论、现有 PR 的评论 / review / 行内评论，以及当前 head 的 CI 摘要。
3. 创建或复用 `harness/<agent.id>/issue-<number>`，启动或恢复 DSH headless 会话。
4. 独立执行配置中的验证命令。失败则停止，不发布未经验证的修改。
5. 提交、非强制推送、创建或更新原 PR，并更新 Issue 检查点。

验证报告区分“桥接器实际执行的退出码”和“agent 自己的总结”。成功发布不等于 PR 已获批准；仍需人工审查。

## 重复运行

相同任务使用稳定分支和同一个 PR。反馈内容及本地 / 远端 SHA 均未变化时，返回 `unchanged`，不再调用模型或新增提交。

只忽略该任务、该操作身份写出的机器检查点；同一账号手工发表的反馈仍然会处理。已关闭或合并的 PR 不会被偷偷重建。

## 中断后怎么做

先执行 `status ISSUE`：

| 阶段 | 处理方式 |
| --- | --- |
| `working` | 保留当前修改，重跑原命令，在原会话继续 |
| `validated` | 复用已验证的内容，校验 Git 状态后继续提交 |
| `publishing` | 复用已有提交，补完 push、PR 或 Issue 回写 |
| `done` | 已发布；有新反馈才继续处理 |

- 不会自动 reset、stash 或覆盖无关的脏工作区。
- 残留锁不能自动抢占。确认任务进程退出后再 `unlock`；活进程会被拒绝。
- 本地任务缓存丢失时，可从 PR 元数据恢复关联。DSH 会话本身仍须保存在本机；找不到它会明确失败，而不是悄悄新建失忆会话。
- 本地缓存与日志位于被忽略的 `.harness/`。GitHub 保存公开任务事实，DSH 保存会话；本项目不另建任务数据库。

## 实现位置

| 文件 | 职责 |
| --- | --- |
| [CLI](../src/cli.mjs) | 手动入口 |
| [任务闭环](../src/core.mjs) | 去重、恢复与发布步骤 |
| [GitHub 适配器](../src/github.mjs) | REST 读取、分页、身份核验、PR / 评论更新 |
| [Git 适配器](../src/repo.mjs) | 分支、独立验证、提交和推送 |
| [DSH 执行器](../src/dsh.mjs) | 真实 headless CLI 与会话续跑 |
| [Cordis 插件](../src/plugin.mjs) | 从会话事件记录任务与 session 的关联 |

## 边界

- 只支持 HTTPS origin，以保证 Git 与 API 使用同一经核验身份。
- 一个工作目录只运行一个执行者；锁不是跨机器的分布式锁。
- GitHub 文本作为不可信数据传入；不将评论直接拼接为 shell 命令。但同一 OS 用户下的进程不是恶意代码隔离边界。
- 基本发布扫描会拒绝常见 token、私钥、敏感文件、大文件及 symlink，但不是完整的秘密检测系统。
- 不自动处理冲突、远端分支超前、跨 fork PR 或缺失的 DSH 历史。
- CI 读取检查摘要，不下载 job logs。反馈超过 2000 条时失败，不静默截断。
- 不含 webhook、定时调度、多 agent 协调、投票、自动审批或合并。
