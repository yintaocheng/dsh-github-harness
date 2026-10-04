# 桌面版安装与使用

[← 返回 README](../README.md)

支持本次实际测试的 **DeepSeek Harness 桌面版 0.2.0-rc.2**。包是官方 bundle 加一个 Host 工具，不是另外启动的 Web 服务，也不是把 session receipt 插件伪装成桌面功能。

## 推荐：插件管理器安装

1. 在桌面侧栏打开 **Plugins → Add plugin**。
2. 输入固定版本地址：

   ```text
   github:yintaocheng/dsh-github-harness#v0.2.0
   ```

3. 检查包名、版本与信任提示，点击 **Install**，再点击 **Enable now**。
4. 确认 bundle 已启用、`github-harness` 行为 active；如管理器提示需要重启，按提示重启后再使用。

只安装、不启用，工具不会进入会话。包不含 `prepare` / `postinstall`，无需为本包放行构建脚本。不要为不兼容的 DSH 版本盲目启用版本豁免。

支持绝对本地路径或 tarball 作为开发安装源，但相对路径、裸 `owner/repo`、GitHub `/tree/…` 网页不是这里的安装 spec。本项目保留 `private: true`，没有宣称已发布 npm 包。

**没有已核实的 `dsh://install` 协议。** 本版 `dsh://open` 只打开/聚焦窗口。这里的快捷安装依赖官方管理器，不是网站按钮点击后无提示安装。

## 首次使用

插件安装不会替你选择目标仓库、GitHub 身份或模型，也不会自动启动任务。

1. 在目标 Git 仓库根目录准备 `harness.local.json`，见[配置示例](setup.md#配置示例)。目标仓库必须忽略 `.harness/` 与 `.reference/`。
2. 配置仓库 `owner/repo`、操作身份 `agent.expectedLogin`、独立 headless 的 `dsh.command` 及验收命令 `verify`。不要在配置或聊天中填写 token。
3. Windows 使用 Git Credential Manager 登录配置的账户。桌面工具先读取现有环境凭据，否则从 GCM 的内存输出取得凭据；不会写入日志或安装参数。
4. 在对话中先调用 `github_harness` 的 `doctor`，确认身份、真实读取能力与 DSH 命令可用；模型能否正常推理仍需[单独检查](setup.md#检查-dsh-模型)。

工具参数：

| 参数 | 意义 |
| --- | --- |
| `action` | `doctor`、`status` 或 `run` |
| `issue` | `status/run` 必须提供正整数 Issue 编号 |
| `workdir` | 目标仓库绝对路径，或相对当前会话工作区的路径 |
| `config` | 可选配置路径；默认目标目录下的 `harness.local.json`，否则 `harness.config.json` |

例如当前会话工作区包含本项目子目录时：

```json
{"action":"doctor","workdir":"dsh-github-harness"}
{"action":"run","issue":1,"workdir":"dsh-github-harness"}
{"action":"status","issue":1,"workdir":"dsh-github-harness"}
```

运行使用安装包内的共享执行器，不要求把桥接器源文件复制到每个目标仓库，也不会全局改变桌面进程的工作目录。任务仍由**另一个独立 headless 会话**执行；反馈继续使用原 Issue、会话和 PR。

## 权限、取消与关闭

Host 插件本身运行在工作区文件沙箱之外。因此本工具沿用 DSH 的 `sandboxPolicy + approveEscalation`：当前已是 full-access 时直接继续，否则需要本次操作的允许；审批禁用或被拒时停止，不能静默运行原生文件/进程操作。

- `status` 不查询凭据、不写目标任务目录；Host 入口仍受上述统一权限门约束。
- `doctor` 只读 GitHub，但会在本地忽略目录写诊断日志。
- `run` 会执行代码、测试、Git 与 GitHub 写操作；只用于可信仓库。
- 取消信号传递到 HTTP、Git、测试和 headless 子进程；Windows 终止所属进程树，POSIX 终止受控进程组。正常取消后执行器释放任务锁。
- 关闭插件会取消并等待它拥有的前台任务，不另建无主后台进程或调度器。强杀整个桌面/机器断电仍可能留下锁，应按[恢复说明](operations.md#中断后怎么做)处理。

## 可选：一条命令安装

使用**该桌面自带的 CLI**，不是另行 npm 安装的 dsh。桌面先运行初始化一次，然后从托盘/菜单**完全退出**；关闭窗口可能只是隐藏。将路径换成你的实际安装位置：

```powershell
$dsh = 'C:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add 'github:yintaocheng/dsh-github-harness#v0.2.0' --ignore-scripts
```

安装后重新打开桌面。查看与移除同样使用此 CLI；修改前仍需完全退出桌面：

```powershell
& $dsh plugin --profile desktop list
& $dsh plugin --profile desktop remove dsh-github-harness
```

不要手改桌面 profile、复制 DSH/Cordis runtime、改 ASAR 或另起一个服务器。`--profile desktop` 不能用于 CLI boot/dump。包版本替换可能需要重新启动才能加载新的 JS。

## 本次验证的范围

已用桌面自带 CLI 在全新 `DSH_HOME` 中安装真实 tarball，确认 bundle 被启用，完整 Loader 的 `appReady` 后能取得 `github_harness`；受限模式下调用被拒，授权模式下 `status` 读取了目标仓库的真实任务缓存，而不是安装目录。单元/集成测试还覆盖工作目录、不读取凭据的 status、取消进程树与释放锁。

发布后还从真正的 GitHub `v0.2.0` 标签重新安装，下载提交为 `337146e281c981135d4d60ceac6a5648dfbefc0b`；已安装工具再次通过权限拒绝、真实 `status` 和 `doctor`（身份、四类读取、DSH help）的检查。本地 tarball 阶段另验过移除后冷启动，工具不再注册。pnpm 对 Git 包给出忽略 build 和缺本地 peer 的提示，但此包直接执行 ESM，实测不需要放行构建脚本。

这验证了本机桌面携带 runtime 的安装和 Host 工具契约，**不等于已经在用户当前桌面 profile 点击安装并验完 UI**。本次没有退出、重启或修改正在使用的 desktop/headless profile，也没有把新的模型调用冒充成当前桌面对话直接执行。完整证据与发布版本见[验证记录](validation.md)。

`DSH_HOME` 隔离的是 DSH 状态，不是恶意插件的 OS 安全沙箱；包管理器仍可能读取用户级配置。pnpm 的 core peer 提示应结合 DSH 实际启动审计判断，不要为了消除提示复制第二份宿主 runtime。
