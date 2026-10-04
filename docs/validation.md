# 实际验证记录

验证日期：2026-10-04，Asia/Shanghai。首轮 GitHub 事实采集：16:23；后续 README 公开版验证见文末。不是仅用 mock 声称端到端成功。

## 环境、身份与交付位置

- 默认工作区：`C:\Users\yin taocheng\Documents\deepseek-harness\default-workspace`。开始时为空。
- 仅创建并初始化其中的 `dsh-github-harness` 项目为 Git 仓库；后续开发、测试、Git 和 headless 均以该项目为 cwd。没有初始化父工作区，没有第二个 checkout / worktree。
- Windows；Node `v22.19.0`；Git `2.51.0.windows.1`；DSH `0.2.0-rc.2`。
- 首次写入 GitHub 前，Credential Manager 浏览器授权完成，`GET /user` 核验实际登录为 `yintaocheng`。配置分别记录 owner=`yintaocheng`、agent.id=`solo`、agent.expectedLogin=`yintaocheng`。
- 创建了私有仓库：[yintaocheng/dsh-github-harness](https://github.com/yintaocheng/dsh-github-harness)。main 放桥接器及文档；任务成果在未合并 PR 内，未做自动 approve / merge。
- API 与 Git HTTPS 在最终实现中使用同一已核验 token。凭据不入提示词、URL、argv、代码仓库或日志。

## 真实闭环证据

| 阶段 | 实际结果 |
| --- | --- |
| 任务 | [Issue #1](https://github.com/yintaocheng/dsh-github-harness/issues/1)：实现 `owner/repo#123` 纯解析函数、非法输入测试和用法示例 |
| 首次执行 | 独立 DSH headless，提交 [`0966d94`](https://github.com/yintaocheng/dsh-github-harness/commit/0966d943b6c9c5cfc2cf4f0bf4ebac2e5a19700c)，17/17 测试通过，创建 [PR #2](https://github.com/yintaocheng/dsh-github-harness/pull/2) |
| 结果回写 | [Issue 检查点](https://github.com/yintaocheng/dsh-github-harness/issues/1#issuecomment-5977910605)：任务 / agent / 操作身份 / session / branch / SHA / PR / 独立验证 / agent 未解决事项 |
| 新反馈 | 在同一 PR 发布[新增 URL 支持要求](https://github.com/yintaocheng/dsh-github-harness/pull/2#issuecomment-5977917765)，不是预先塞进第一次提示词 |
| 反馈续跑 | 同 session，提交 [`16b3bde`](https://github.com/yintaocheng/dsh-github-harness/commit/16b3bdeee6c6bc1ef6cfd2042c4ad96566f3849d)，补 HTTPS Issue URL 支持及拒绝不安全 URL 的测试，19/19 通过，复用 PR #2 |
| 最终验证 | 同步 main 上的身份 / 恢复加固后，PR head 为 [`609b159`](https://github.com/yintaocheng/dsh-github-harness/commit/609b159f5098634a2483ff4eb2bfd1093b82ac56)，21/21 本地标准测试通过 |
| GitHub CI | 当前准确 SHA 的 [PR check](https://github.com/yintaocheng/dsh-github-harness/actions/runs/37188484266/job/111395482545) 和 [push check](https://github.com/yintaocheng/dsh-github-harness/actions/runs/37188481593/job/111395474607) 均 `completed / success` |

任务分支：`harness/solo/issue-1`。

三次真正模型执行的 session 始终为 `session-3847cc24-ee0e-4471-89f0-5d33972d49e8`：首次实现、新增反馈、消费最终 CI。最后一次只验证既有实现，无代码变更 / 无新提交。三个本地 NDJSON opening session 事件均为该 ID，cwd 均为项目目录。没有另建 agent 团队。

## 重复启动与中断恢复：真实验证

1. **发布真的失败过**：第二轮修改和独立测试完成、提交已保存后，Git push 出现 `curl 28 / connection reset`，任务停在 `publishing`。后续 fetch 也有连接超时。
2. 原命令重试没有重新运行模型。诊断发现本机已启用 `127.0.0.1:7897` 系统代理，而 Git 未继承。仅设置当前进程 `HTTPS_PROXY` 复用已有代理后，原提交 `16b3bde` 推送成功、原 PR / 原 Issue 检查点更新。未修改全局网络 / Git 配置，未关闭 TLS 校验。单独切换 TLS 后端并不能稳定解决，不能把它当根因修复。
3. 消费最终 CI 后立即重跑，返回 `status: unchanged`，PR #2、SHA、session 均保持不变，没有新增模型日志或提交。
4. 备份本地任务缓存，再把缓存重置为仅含 task key / branch（模拟缓存丢失），运行原命令；从真实 PR 元数据恢复了 session、输入哈希、HEAD、PR URL 和 `phase: done`，返回 `unchanged`。没有用空的本地验证记录覆盖远端报告。
5. 真实第二轮运行期间，尝试获取同一工作目录锁被拒绝；未启动并发 agent。

测试后的 PR 仍为 **open**。Issue 尚未关闭；只有未来审查通过并合并 PR 时，`Closes #1` 才可能关闭它。

## 离线自动测试：与真实验证分开

首轮交付时，main 的桥接器测试为 **14/14**。PR #2 分支另外有 7 组解析任务测试，共 **21/21**。覆盖：

- 首次发布 / 同反馈 no-op / 同 Issue、PR review、CI 反馈续跑。
- PR 创建成功但响应丢失、检查点失败后重试、发布期间到达新反馈不被吞掉。
- 验证失败不发布；closed / merged PR 不重建。
- 本地缓存丢失恢复、保留验证报告、缺失 Issue 检查点从 PR 修复。
- API 身份不匹配先失败、Git 与 API 绑定同一凭据、分页、配置 / 远端拒绝规则。
- 真实 headless NDJSON `reason.kind=completed` 契约及不完整终态拒绝。

PR response-loss 和 CI failure 分支是**故障注入测试**；没有谎称真的制造了 GitHub API 响应丢失或一轮失败 CI 修复。

## 本机运行方式

在项目根目录执行：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7897' # 本机已有代理；其他环境请使用自己的网络配置
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/run.ps1 --config harness.local.json doctor
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/run.ps1 --config harness.local.json run 1
node src/cli.mjs --config harness.local.json status 1
```

本地配置仍保留在被忽略的 `harness.local.json`，使用本机安装的 DSH 命令及仅含凭据引用的模型 overlay；可继续跑。源码与公共配置不包含这些机器路径 / 密钥值。通用安装说明见 [README](../README.md)，接口依据见 [interfaces](interfaces.md)。

## 环境问题、边界与尚未验证

- 默认 headless 的 DeepSeek 路由首次 smoke 返回 401。已通过本地 overlay 复用当前 desktop 的 `cliproxyapi / gpt-6-astra` 和凭据引用，真实模型任务成功；未修改 desktop 全局配置。
- DSH agent 的 workspace-write 沙箱内，标准 Node 测试隔离子进程触发 `spawn EPERM`。agent 没有绕过沙箱，而是使用 Node 官方的进程内测试模式；可信桥接器和 GitHub CI 另外执行原标准命令 `node --test test/*.test.mjs` 并通过。报告同时保留 agent 的限制说明和独立执行退出码。
- 未验证 OS 强杀恰好落在每一个文件写入边界、断电 fsync 级耐久性、DSH 持久化目录本身丢失、另一个 OS / 全新机器模型环境、跨 fork / 多身份并行。
- CI feedback 的成功检查在真实环境读取并消费；失败 CI / review-state 处理目前由离线用例覆盖。未下载 job logs。
- 验证失败时目前停止发布并保留本地诊断，不自动发布新的失败评论。只读 status 可查看当前任务；需要人工解决后重跑。
- 不含 webhook 自动触发、调度平台、多 agent 协调、投票或自动合并。工作目录锁只针对本机单 checkout；不是分布式锁。凭据环境隔离不是恶意仓库的完整防护。

## 后续验证：README 公开版与当前 DSH 实测

同日按用户要求重写首页，并使用当前 DSH 会话进行第二个真实任务验证：

- [README 改进提交 `9c4ba7d`](https://github.com/yintaocheng/dsh-github-harness/commit/9c4ba7db651988a18016bc48bc4f735e53c3d156)：首页只保留用途、三步启动和结果入口；详细内容移入 [安装配置](setup.md) 与 [运行恢复](operations.md)。增加 [Windows 短入口](../harness.cmd)。
- 核验时仓库已经为 `public`，因此没有重复修改可见性。无认证 API 返回 HTTP 200 / `visibility: public`；未登录浏览器成功读取 GitHub 渲染后的新版 README。
- 预检扫描了当时的 30 个历史 blob、20 个工作区文件及 4 条 Issue/PR 内容，未发现常见凭据模式或当前 GitHub token。运行目录和本地配置没有进入 Git 历史。这是基本检查，不是完整秘密扫描保证；没有重写旧历史，其中仍有早期开发机器路径。
- 当前 DSH 会话执行 `harness.cmd run 3`，启动独立 headless session `session-56afa985-a663-43ce-b1a8-9d37d0340373`，处理 [Issue #3](https://github.com/yintaocheng/dsh-github-harness/issues/3)。
- agent 只新增文档回归测试，生成 [PR #4](https://github.com/yintaocheng/dsh-github-harness/pull/4)，head 为 [`93f6a4a`](https://github.com/yintaocheng/dsh-github-harness/commit/93f6a4a0c23ecdcf6b9f4186a78495c2f6cf84a4)，并更新 [Issue 检查点](https://github.com/yintaocheng/dsh-github-harness/issues/3#issuecomment-5978286299)。PR 未合并。
- 该任务分支 **19/19 本地测试通过**；准确 head 对应的 [PR CI](https://github.com/yintaocheng/dsh-github-harness/actions/runs/37190424466/job/111401249404) 和 [push CI](https://github.com/yintaocheng/dsh-github-harness/actions/runs/37190421007/job/111401238917) 均 `completed / success`。
- 无凭据 `help` / `status` 可用，`doctor` 实际核验为 `yintaocheng`。收尾负向测试发现短入口最初吞掉失败退出码，已修复，并新增 [Windows 启动器回归测试](../test/launcher.test.mjs)：检查带空格路径、配置回退 / 本地覆盖以及失败退出码。修复后的 main 在 Windows **15/15 通过**；此 Windows 专项测试在 Linux 跳过。

这里的“在 DSH 中测试”指从当前 DSH 会话调用上述命令，实际启动独立 DSH agent。没有新增 GUI 按钮，也没有另开 Web 服务。
