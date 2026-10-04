# 实际验证记录

## v0.2.0：六项修复与桌面安装适配

2026-10-04，Windows / Node v22.19.0 / Git 2.51.0.windows.1 / 桌面 DSH 0.2.0-rc.2。

### 回归结果

标准命令 `node --test test/*.test.mjs`：**81 tests，81 pass，0 fail，0 skipped**（65 个顶层测试，含子测试）。这不是把原 PR 分支的旧测试数混算进来。

| 问题 | 实际覆盖 |
| --- | --- |
| 首轮无修改卡住 | 真实 Git：`waiting → unchanged → 新反馈后 published`；mock 另测旧 `validated` 死角迁移及无 PR 的 Issue 检查点恢复 |
| 验收配置未参与去重 | `done / validated / publishing` 分别变更命令，重验且不增加模型轮次；真实 Git 的同 HEAD 新失败验收会阻止再次发布 |
| hook 改变最终提交 | 真实 pre-commit 改写并暂存文件；新内容失败时没有 push/PR，成功时第二次验收绑定实际 HEAD tree；另测相同树但错误 parent 的恢复拒绝 |
| 整库扫描误伤大文件 | 真实基线含超过 2 MiB 的未修改文件，小变更可暂存；该大文件被修改后仍拒绝；新增凭据与被跟踪运行态仍拒绝 |
| Commit statuses 权限与 doctor | 纯 mock 覆盖私库 statuses 403、其他读取失败、空仓库/不可见区分、公有端点不证明 scope；实际 public 仓库 doctor 的四类 GET 均成功，写能力仍标记未验证 |
| Windows 环境键大小写 | 对含混合大小写实际键名的环境对象测试删除全部 GH_TOKEN/GITHUB_TOKEN 变体，并保持输入与其他变量不变；不声称进行了真实凭据泄漏实验 |

另覆盖验证命令改动候选树、旧远程元数据无绑定时重验、发布响应丢失、检查点重试不吞反馈、同 PR 无新增修改等路径。测试文件为 [core](../test/core.test.mjs)、[真实 Git](../test/repo.test.mjs)、[认证](../test/auth.test.mjs)、[桌面](../test/desktop.test.mjs) 和 [Windows 启动器](../test/launcher.test.mjs)。

### 桌面安装与真实 Loader

1. `npm pack --ignore-scripts` 生成带 bundle patch 和独立 Host 入口的 tarball，白名单排除本地配置、运行日志与参考缓存。
2. 通过桌面自带 CLI，在项目忽略目录中的全新 `DSH_HOME` 初始化命名 headless profile；没有复用、修改或退出用户正在使用的 desktop/headless profile。
3. 官方 `plugin --profile ... add <绝对 tarball> --ignore-scripts` 退出 0，profile 的 bundle 列表真实包含 `dsh-github-harness`。
4. 禁用该测试 profile 的模型启动器，完整 boot/audit 成功后的 `appReady` 取得注册工具，实际返回：

   ```json
   {"ok":true,"registered":true,"restrictedCallDenied":true,"mode":"read-only"}
   ```

5. 仅在独立测试启动进程中使用授权模式，调用**已安装包**的 `status`，实际返回：

   ```json
   {"ok":true,"registered":true,"action":"status","workspaceCorrect":true,"phase":"done","mode":"danger-full-access"}
   ```

   核对的是项目中 Issue #3 的缓存 key；不是安装目录，也不是模型口头声称工具存在。此调用不需要 GitHub 凭据。
6. 官方 CLI 从**该隔离测试 profile** 移除包后，重新完整启动 Loader，返回 `{"ok":true,"removed":true,"toolAbsent":true}`。这是冷启动移除验证，不冒充当前 GUI 的热卸载测试。
7. 桌面回归测试另外验证：加载声明无副作用、受限模式先拒绝再谈 I/O、显式 cwd、不变更全局 cwd、status 不创建状态目录或查询凭据、取消 HTTP 后释放锁、真实父子进程树终止、启动检查点失败不留子进程。

遇到的本机环境问题：npm 原缓存指向不可写的 Program Files，首次 pack 因 EPERM 失败；改用命令级项目缓存后成功，没有提权、改 ACL 或修改全局 npm 配置。pnpm 提示 core peers 未作为本地普通依赖安装；本次使用桌面 carrier 提供的 runtime，后续真实启动审计和工具调用成功，没有复制第二份 DSH/Cordis。移除时发现 pnpm 11 的 `remove` 不接受 `--ignore-scripts`，改为进程级设置及原测试 store 后成功；正式使用文档采用已验证的受支持参数。候选 blob 扫描另外验证了被拒绝的凭据样本不会残留在持久日志中。

本节记录的是已执行的本地 tarball 安装与 Host 行为。固定 GitHub tag 的网络安装在发布后另行核验。没有把它声称为当前桌面 GUI 已被自动安装，也没有重新跑一次模型 Issue→PR 来冒充桌面完整业务验证。下方两次真实模型任务是先前阶段证据，原 PR 仍保留审查，不自动合并。

---

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
