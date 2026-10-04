# 桌面版安装与使用

[← README](../README.md)

社区插件，使用 DSH 官方 bundle / Host 工具接口，兼容目标为 **DeepSeek Harness 0.2.0-rc.2**。不另开 Web 服务，也没有额外的任务管理页面。

## 插件管理器安装

在桌面 **Plugins → Add plugin** 输入：

```text
github:yintaocheng/dsh-github-harness#v0.3.0
```

检查后选择 **Install → Enable now**，遵循重启提示。安装与启用是两步。包没有 `prepare` / `postinstall`，无需为本包放行构建脚本。

npm 发布暂缓；目前没有可用的 `dsh-github-harness@0.3.0` npm / 镜像发布承诺，见[分发状态](distribution.md)。

## 官方桌面 CLI

先初始化桌面，再从托盘/菜单**完全退出**。使用该桌面携带的 CLI，不是另装一套 runtime。替换实际安装位置：

```powershell
$dsh = 'C:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add 'github:yintaocheng/dsh-github-harness#v0.3.0' --ignore-scripts
& $dsh plugin --profile desktop list
```

重新打开桌面，在 Plugins 中检查启用状态。移除前同样完全退出桌面，再运行：

```powershell
& $dsh plugin --profile desktop remove dsh-github-harness
```

不要手改 profile、ASAR、复制另一套 Cordis / DSH runtime，或通过版本豁免掩盖接口不兼容。`--profile desktop` 不能用于 CLI boot/dump。更换包版本后可能需要重启才能加载新的 JS。

开发验收可以用绝对目录 / tarball；不能把 GitHub `/tree/…` 网页或裸 `owner/repo` 当成安装 spec。没有已核实的 `dsh://install` 深链，本版 `dsh://open` 只负责打开/聚焦窗口。

## 选择目标项目

插件安装不会自动选择仓库、登录身份或模型，也不会启动任务。在**目标仓库**根目录准备[本地配置](setup.md#配置示例)，并忽略本地配置、`.harness/`、`.reference/`。

| 工具参数 | 含义 |
| --- | --- |
| `action` | `doctor`、`status` 或 `run` |
| `issue` | `status/run` 必须提供正整数 Issue 编号 |
| `workdir` | 目标仓库绝对路径，或相对当前会话工作区的路径 |
| `config` | 配置路径；默认目标目录中的本地配置，否则通用配置 |

例如 `github_harness` 的一次调用：

```json
{"action":"run","issue":1,"workdir":"my-project"}
```

先用 `doctor` 检查账户和仓库，再执行任务。Windows Host 工具先取进程环境凭据，否则使用 GCM 的内存输出；不会自动弹出 GitHub 登录页面。模型推理需要[单独验证](setup.md#检查-dsh-模型)。

每次调用捕获自己的项目上下文，不使用插件安装 cwd，不改变全局 `process.cwd()`。任务由独立 headless 会话执行，新反馈继续同一任务；不同项目和 Issue 不混用任务状态。

## 权限与取消

Host 原生 I/O 并不会因为工具注册而自动受工作区沙箱保护，因此工具使用官方 `sandboxPolicy + approveEscalation` 权限门。当前已是 full-access 时继续，否则需要本次访问获准；审批禁用或拒绝时停止。

- `status` 不查凭据、不创建或写入任务目录，但 Host 入口仍受统一权限门约束。
- `doctor` 只读 GitHub，在本地忽略目录写诊断日志；不能证明 token 写 scope。
- `run` 会执行代码、测试、Git 和 GitHub 写操作，只用于可信仓库。
- 取消传递到 HTTP、Git、测试和 headless 进程；正常取消后终止所属进程树并释放锁。
- 插件关闭会取消并等待自有前台任务；强杀/断电仍可能留锁，按[恢复说明](operations.md#中断后怎么做)处理。

## 验证边界

安装、Loader 注册、权限拒绝、实际工具调用、真实模型执行是不同的验证环节，不能互相替代。具体结果放在[演示证据](https://github.com/yintaocheng/dsh-github-harness-demo/tree/main/evidence)。

隔离 `DSH_HOME` / profile 只隔离 DSH 状态，不是 OS 沙箱；包管理器仍可能读取用户级配置。不把隔离 profile 的 CLI 验证说成已替用户在当前 GUI 中点击安装。
